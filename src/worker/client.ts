import type { ModelStats, OptimizationSettings, OptimizeResult, Project } from "@/domain/types";

export interface SolverReady {
  ok: boolean;
  detail: string;
}

const EMPTY_STATS: ModelStats = {
  binaries: 0,
  integers: 0,
  continuous: 0,
  constraints: 0,
  eliminatedAssignments: 0,
  possibleAssignments: 0,
  warning: null,
};

function cancelledResult(): OptimizeResult {
  return {
    solver: "highs",
    cancelled: true,
    provedInfeasible: false,
    feasible: false,
    message: "Optimization was cancelled before a validated schedule was accepted.",
    findings: [],
    proposals: [],
    stats: EMPTY_STATS,
    stages: [],
  };
}

interface Pending {
  resolve: (result: OptimizeResult) => void;
  reject: (error: Error) => void;
  progress: (stage: string, detail: string) => void;
}

export function createOptimizer(onReady: (ready: SolverReady) => void) {
  let worker = spawn();
  let pending: Pending | null = null;

  function spawn() {
    const next = new Worker(new URL("./optimizer.worker.ts", import.meta.url), { type: "module" });
    next.onmessage = (event: MessageEvent<{ type: string; ok?: boolean; status?: string; objective?: number | null; error?: string; stage?: string; detail?: string; result?: OptimizeResult }>) => {
      const message = event.data;
      if (message.type === "ready") {
        onReady({
          ok: Boolean(message.ok),
          detail: message.ok
            ? `Binary test solved to objective ${message.objective}. Status ${message.status}.`
            : message.error || "The solver self-test failed.",
        });
        return;
      }
      const current = pending;
      if (!current) return;
      if (message.type === "progress") current.progress(message.stage ?? "", message.detail ?? "");
      if (message.type === "result" && message.result) {
        pending = null;
        current.resolve(message.result);
      }
      if (message.type === "error") {
        pending = null;
        current.reject(new Error(message.error || "The solver failed."));
      }
    };
    next.onerror = (event) => {
      const current = pending;
      if (!current) return;
      pending = null;
      current.reject(new Error(event.message || "The optimization worker failed."));
    };
    return next;
  }

  return {
    optimize(project: Project, settings: OptimizationSettings, progress: Pending["progress"]) {
      return new Promise<OptimizeResult>((resolve, reject) => {
        if (pending) {
          reject(new Error("An optimization is already running."));
          return;
        }
        pending = { resolve, reject, progress };
        worker.postMessage({ type: "optimize", project, settings });
      });
    },
    stop() {
      const current = pending;
      pending = null;
      worker.terminate();
      worker = spawn();
      current?.resolve(cancelledResult());
    },
    dispose() {
      pending = null;
      worker.terminate();
    },
  };
}
