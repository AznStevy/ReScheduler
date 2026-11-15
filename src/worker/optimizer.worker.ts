import wasmUrl from "highs/runtime?url";
import { optimizeSchedule } from "@/solver/engine";
import { createHighsSolver } from "@/solver/highsAdapter";
import { BINARY_IP, type Solver } from "@/solver/solver";
import type { OptimizationSettings, Project } from "@/domain/types";

let solver: Solver | null = null;
let cancel = false;

function post(message: unknown) {
  self.postMessage(message);
}

createHighsSolver((file) => (file.endsWith(".wasm") ? wasmUrl : file))
  .then((loaded) => {
    solver = loaded;
    const smoke = loaded.solve(BINARY_IP, { timeLimitSeconds: 10, randomSeed: 1, mipRelGap: 0 });
    const ok = smoke.status === "Optimal" && smoke.objective === 1 && smoke.provenOptimal;
    post({ type: "ready", ok, status: smoke.status, objective: smoke.objective, error: ok ? "" : "The binary test did not return a proved optimum of 1." });
  })
  .catch((error: unknown) => {
    post({ type: "ready", ok: false, status: "error", objective: null, error: error instanceof Error ? error.message : String(error) });
  });

self.onmessage = (event: MessageEvent<{ type: string; project?: Project; settings?: OptimizationSettings }>) => {
  if (event.data.type === "cancel") {
    cancel = true;
    return;
  }
  if (event.data.type !== "optimize" || !event.data.project || !event.data.settings) return;
  cancel = false;
  if (!solver) {
    post({ type: "error", error: "The optimization solver failed to load. No schedule was invented." });
    return;
  }
  const active = solver;
  void optimizeSchedule(event.data.project, event.data.settings, active, {
    cancelled: () => cancel,
    progress: (stage, detail) => post({ type: "progress", stage, detail }),
    yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
  })
    .then((result) => post({ type: "result", result }))
    .catch((error: unknown) => post({ type: "error", error: error instanceof Error ? error.message : String(error) }));
};
