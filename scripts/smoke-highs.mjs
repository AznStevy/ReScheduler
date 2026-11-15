import loadHighs from "highs";

const binaryIp = `Maximize
 obj: x + y
Subject To
 c1: x + y <= 1
Bounds
 0 <= x <= 1
 0 <= y <= 1
Binary
 x y
End`;

const infeasible = `Minimize
 obj: x
Subject To
 c1: x >= 2
Bounds
 0 <= x <= 1
Binary
 x
End`;

const highs = await loadHighs();
const optimal = highs.solve(binaryIp, { output_flag: false, random_seed: 1 });
console.log(
  "binary",
  optimal.Status,
  optimal.ObjectiveValue,
  optimal.Columns?.x?.Primal,
  optimal.Columns?.y?.Primal,
);

const timeout = highs.solve(binaryIp, { output_flag: false, time_limit: 0 });
console.log("time_limit_0", timeout.Status, timeout.ObjectiveValue);

const inf = highs.solve(infeasible, { output_flag: false });
const negative = `Minimize
 obj: x
Subject To
 c1: 1 x >= -2
Bounds
 0 <= x <= 1
Binary
 x
End`;

const multiline = `Minimize
 obj: x
  + 1 y
Subject To
 c1: 1 x
  + 1 y <= 1
Bounds
 0 <= x <= 1
 0 <= y <= 1
Binary
 x
 y
End`;

for (const [label, problem] of [["negative", negative], ["multiline", multiline]]) {
  try {
    const result = highs.solve(problem, { output_flag: false });
    console.log(label, result.Status, result.ObjectiveValue);
  } catch (error) {
    console.log(label, "threw", error);
  }
}

const model = highs.createModel({ format: "lp", data: binaryIp });
try {
  model.options.set({ output_flag: false, time_limit: 5, random_seed: 1, mip_rel_gap: 0 });
  model.run();
  console.log("persistent status", model.getModelStatus());
  console.log("persistent objective", model.getObjectiveValue());
  console.log(
    "info",
    ["run_time", "mip_gap", "mip_node_count"].map((key) => {
      try {
        return [key, model.info.get(key)];
      } catch (error) {
        return [key, String(error)];
      }
    }),
  );
  const solution = model.getSolution();
  console.log("solution keys", solution && Object.keys(solution));
} finally {
  model.dispose();
}
