import { createHighsSolver } from "@/solver/highsAdapter";
import { optimizeSchedule } from "@/solver/engine";
import { describe, expect, it } from "vitest";
import { buildInternalMedicineDemo, defaultSettings } from "./scenarios";

describe("synthetic program feasibility", () => {
  it("finds a validated schedule for the 60-resident demo or stops without inventing one", async () => {
    const solver = await createHighsSolver();
    const result = await optimizeSchedule(
      buildInternalMedicineDemo(),
      { ...defaultSettings(), timeLimitSeconds: 20, generateAlternatives: false },
      solver,
      { cancelled: () => false, progress: () => undefined, yield: async () => undefined },
    );
    expect(result.cancelled).toBe(false);
    expect(result.feasible).toBe(true);
    expect(result.proposals.some((proposal) => proposal.validation.ok)).toBe(true);
  }, 120_000);
});
