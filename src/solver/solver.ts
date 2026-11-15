export interface SolverOptions {
  timeLimitSeconds: number;
  randomSeed: number | null;
  mipRelGap: number;
}

export interface SolverProgress {
  gap: number | null;
  incumbent: number | null;
  runtimeSeconds: number | null;
}

export interface SolverOutput {
  status: string;
  provenOptimal: boolean;
  hasSolution: boolean;
  objective: number | null;
  values: Record<string, number>;
  runtimeSeconds: number;
  gap: number | null;
}

export interface Solver {
  solve(lp: string, options: SolverOptions, onProgress?: (progress: SolverProgress) => void): SolverOutput;
}

export const BINARY_IP = `Maximize
 obj: x + y
Subject To
 c1: x + y <= 1
Bounds
 0 <= x <= 1
 0 <= y <= 1
Binary
 x y
End`;
