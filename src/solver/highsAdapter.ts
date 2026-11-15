import loadHighs, { type Highs } from "highs";
import { BINARY_IP, type Solver, type SolverOptions, type SolverOutput, type SolverProgress } from "./solver";

const STATUS_NAME: Record<number, string> = {
  0: "Not Set",
  1: "Load error",
  2: "Model error",
  3: "Presolve error",
  4: "Solve error",
  5: "Postsolve error",
  6: "Empty",
  7: "Optimal",
  8: "Infeasible",
  9: "Primal infeasible or unbounded",
  10: "Unbounded",
  11: "Bound on objective reached",
  12: "Target for objective reached",
  13: "Time limit reached",
  14: "Iteration limit reached",
  15: "Unknown",
  16: "Solution limit reached",
  17: "Interrupted",
};

let cached: Promise<Highs> | null = null;

async function loadRuntime(locateFile?: (file: string) => string): Promise<Highs> {
  if (locateFile) return loadHighs({ locateFile });
  if (!cached) cached = loadHighs();
  return cached;
}

export async function createHighsSolver(locateFile?: (file: string) => string): Promise<Solver> {
  const highs = await loadRuntime(locateFile);
  return {
    solve(lp, options, onProgress) {
      return solveLoaded(highs, lp, options, onProgress);
    },
  };
}

export async function solveBinarySmoke(locateFile?: (file: string) => string): Promise<SolverOutput> {
  const solver = await createHighsSolver(locateFile);
  return solver.solve(BINARY_IP, { timeLimitSeconds: 10, randomSeed: 1, mipRelGap: 0 });
}

function solveLoaded(
  highs: Highs,
  lp: string,
  options: SolverOptions,
  onProgress?: (progress: SolverProgress) => void,
): SolverOutput {
    const started = performance.now();
    const model = highs.createModel({ format: "lp", data: lp });
    try {
      const optionValues: Record<string, boolean | number | string> = {
        output_flag: false,
        log_to_console: false,
        presolve: "on",
        time_limit: options.timeLimitSeconds,
        mip_rel_gap: options.mipRelGap,
      };
      if (options.randomSeed != null) optionValues.random_seed = options.randomSeed;
      model.options.set(optionValues);
      let gap: number | null = null;
      let forcedStop = false;
      const stopIfLate = (event: { interrupt: () => void }) => {
        if ((performance.now() - started) / 1000 >= options.timeLimitSeconds) {
          forcedStop = true;
          event.interrupt();
        }
      };
      const noteProgress = (event: { data: { mip_gap?: number; mip_primal_bound?: number; running_time?: number } }) => {
        if (typeof event.data.mip_gap === "number" && Number.isFinite(event.data.mip_gap)) gap = event.data.mip_gap;
        try {
          onProgress?.({
            gap,
            incumbent: typeof event.data.mip_primal_bound === "number" && Number.isFinite(event.data.mip_primal_bound)
              ? event.data.mip_primal_bound
              : null,
            runtimeSeconds: event.data.running_time ?? null,
          });
        } catch {
          // Progress reporting must not fail the solve.
        }
      };
      model.run({
        [highs.constants.callbackType.mipLogging](event) {
          noteProgress(event);
        },
        [highs.constants.callbackType.mipInterrupt](event) {
          noteProgress(event);
          stopIfLate(event);
        },
        [highs.constants.callbackType.simplexInterrupt](event) {
          stopIfLate(event);
        },
        [highs.constants.callbackType.ipmInterrupt](event) {
          stopIfLate(event);
        },
      });
    const statusCode = model.getModelStatus();
    let status = STATUS_NAME[statusCode] ?? `status ${statusCode}`;
    if (forcedStop && statusCode === highs.constants.modelStatus.interrupted) status = "Time limit reached";
    let objective: number | null = null;
    try {
      const raw = model.getObjectiveValue();
      objective = Number.isFinite(raw) ? raw : null;
    } catch {
      objective = null;
    }
    let hasSolution = statusCode === highs.constants.modelStatus.optimal;
    try {
      const primal = Number(model.info.get("primal_solution_status"));
      if (primal === highs.constants.solutionStatus.feasible) hasSolution = true;
      if (primal === highs.constants.solutionStatus.none) hasSolution = false;
    } catch {
      // Keep the status-code fallback.
    }
    const values: Record<string, number> = {};
    if (hasSolution) {
      try {
        const solution = model.getSolution();
        for (let index = 0; index < solution.colValue.length; index += 1) {
          values[model.getColName(index)] = solution.colValue[index];
        }
      } catch {
        hasSolution = false;
      }
    }
    if (gap == null) {
      try {
        const infoGap = model.info.get("mip_gap");
        if (typeof infoGap === "number" && Number.isFinite(infoGap)) gap = infoGap;
      } catch {
        gap = null;
      }
    }
    if (statusCode === highs.constants.modelStatus.optimal) gap = 0;
    let runtimeSeconds = (performance.now() - started) / 1000;
    try {
      const native = model.getRunTime();
      if (Number.isFinite(native)) runtimeSeconds = native;
    } catch {
      // Wall-clock fallback above.
    }
    return {
      status,
      provenOptimal: statusCode === highs.constants.modelStatus.optimal && !forcedStop,
      hasSolution,
      objective,
      values,
      runtimeSeconds,
      gap,
    };
  } finally {
    model.dispose();
  }
}
