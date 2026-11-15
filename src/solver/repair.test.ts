import { makeBlocks } from "@/domain/calendar";
import type { Assignment, Project, Resident, Rotation, RotationCategory } from "@/domain/types";
import { repairsForIssue } from "@/solver/repair";
import { validateSchedule } from "@/solver/validate";
import { describe, expect, it } from "vitest";

function resident(id: string, name: string, pgy = 1): Resident {
  return {
    id,
    name,
    pgy,
    track: "Categorical",
    startDate: "2026-07-01",
    graduationDate: "2029-06-30",
    previousRotations: [],
    careerInterests: [],
    electivePreferences: [],
    restrictions: [],
    historicalBurden: { icu: 0, nights: 0, wards: 0, holiday: 0 },
    lockedAssignments: [],
    waivers: [],
    notes: "",
  };
}

function rotation(blocks: Project["blocks"], id: string, name: string, category: RotationCategory, min: number, max: number, extra: Partial<Rotation> = {}): Rotation {
  return {
    id,
    name,
    category,
    durationBlocks: 1,
    eligiblePgy: [1, 2, 3],
    eligibleTracks: [],
    staffing: blocks.map((block) => ({ blockId: block.id, min, max })),
    requirementCredits: [],
    careerRelevance: [],
    workloadIntensity: 2,
    maxConsecutive: null,
    maxBlocksPerResident: null,
    noConsecutiveCategories: [],
    prerequisites: [],
    availableBlocks: [],
    relaxStaffingMin: 0,
    relaxStaffingMax: 0,
    staffingPriority: 1,
    color: "#335566",
    ...extra,
  };
}

function project(partial: Partial<Project> & Pick<Project, "residents" | "rotations" | "blocks" | "assignments">): Project {
  return {
    formatVersion: 1,
    id: "repair",
    name: "Repair",
    academicYear: "2026-2027",
    asOfDate: "2026-07-01",
    blockWeeks: 4,
    interests: [],
    requirements: [],
    vacations: [],
    vacationRules: { defaultCapacity: 2, capacityByBlock: [], blackoutBlockIds: [] },
    staffingWaivers: [],
    scenarioNote: "",
    syntheticDemo: true,
    ...partial,
  };
}

function cell(residentId: string, blockId: string, rotationId: string, duties?: Assignment["duties"]): Assignment {
  return { residentId, blockId, rotationId, locked: false, source: "import", ...(duties ? { duties } : {}) };
}

describe("repairsForIssue", () => {
  it("replaces one ineligible assignment and leaves the other resident", () => {
    const blocks = makeBlocks(2);
    const wards = rotation(blocks, "wards", "Wards", "ward", 0, 2);
    const elective = rotation(blocks, "elective", "Elective", "elective", 0, 2, { eligiblePgy: [2, 3] });
    const clinic = rotation(blocks, "clinic", "Clinic", "ambulatory", 0, 2);
    const sample = project({
      blocks,
      residents: [resident("a", "Avery Quinn"), resident("b", "Blake Santos")],
      rotations: [wards, elective, clinic],
      assignments: [
        cell("a", "b01", "elective", [{ date: "2026-07-02", name: "Clinic" }]),
        cell("a", "b02", "wards"),
        cell("b", "b01", "wards"),
        cell("b", "b02", "clinic"),
      ],
    });
    const issue = validateSchedule(sample, sample.assignments).issues.find((item) => item.code === "ineligible");
    expect(issue).toBeTruthy();
    const plan = repairsForIssue(sample, issue!);
    expect(plan.repairs.length).toBeGreaterThan(0);
    expect(plan.repairs.length).toBeLessThanOrEqual(5);
    expect(plan.repairs.every((repair) => repair.changes === 1)).toBe(true);
    const applied = plan.repairs[0];
    expect(applied.assignments.find((item) => item.residentId === "b" && item.blockId === "b02")?.rotationId).toBe("clinic");
    expect(applied.assignments.find((item) => item.residentId === "a" && item.blockId === "b02")?.rotationId).toBe("wards");
    expect(applied.assignments.find((item) => item.residentId === "a" && item.blockId === "b01")?.duties).toEqual([{ date: "2026-07-02", name: "Clinic" }]);
    const after = validateSchedule(sample, applied.assignments).issues;
    expect(after.some((item) => item.code === "ineligible")).toBe(false);
    expect(after.length).toBe(0);
  });

  it("offers a similarly named rotation before an unrelated one", () => {
    const blocks = makeBlocks(1);
    const sample = project({
      blocks,
      residents: [resident("a", "Avery Quinn")],
      rotations: [
        rotation(blocks, "admitting", "1pm Admitting", "other", 0, 1),
        rotation(blocks, "clinic-north", "Clinic North", "ambulatory", 0, 1),
      ],
      assignments: [cell("a", "b01", "clinic-north-missing")],
    });
    const issue = validateSchedule(sample, sample.assignments).issues.find((item) => item.code === "ineligible");
    const plan = repairsForIssue(sample, issue!);
    expect(plan.repairs[0]?.summary).toContain("Clinic North");
    expect(plan.repairs.every((repair) => repair.changes === 1)).toBe(true);
  });

  it("fills a coverage gap by moving one resident who can leave", () => {
    const blocks = makeBlocks(1);
    const wards = rotation(blocks, "wards", "Wards", "ward", 1, 2);
    const clinic = rotation(blocks, "clinic", "Clinic", "ambulatory", 0, 2);
    const sample = project({
      blocks,
      residents: [resident("a", "Avery Quinn"), resident("b", "Blake Santos")],
      rotations: [wards, clinic],
      assignments: [cell("a", "b01", "clinic"), cell("b", "b01", "clinic")],
    });
    const issue = validateSchedule(sample, sample.assignments).issues.find((item) => item.code === "staffing-min");
    const plan = repairsForIssue(sample, issue!);
    expect(plan.repairs).toHaveLength(2);
    expect(plan.repairs.every((repair) => repair.changes === 1)).toBe(true);
    for (const repair of plan.repairs) {
      expect(validateSchedule(sample, repair.assignments).issues).toHaveLength(0);
    }
  });

  it("does not offer a move that opens a different coverage gap", () => {
    const blocks = makeBlocks(1);
    const wards = rotation(blocks, "wards", "Wards", "ward", 1, 2);
    const icu = rotation(blocks, "icu", "ICU", "icu", 1, 1);
    const clinic = rotation(blocks, "clinic", "Clinic", "ambulatory", 0, 2);
    const sample = project({
      blocks,
      residents: [resident("a", "Avery Quinn"), resident("b", "Blake Santos"), resident("c", "Casey Ng")],
      rotations: [wards, icu, clinic],
      assignments: [cell("a", "b01", "icu"), cell("b", "b01", "clinic"), cell("c", "b01", "clinic")],
    });
    const issue = validateSchedule(sample, sample.assignments).issues.find((item) => item.rotationId === "wards");
    const plan = repairsForIssue(sample, issue!);
    expect(plan.repairs.some((repair) => repair.summary.includes("Avery"))).toBe(false);
    expect(plan.repairs.length).toBeGreaterThan(0);
    expect(plan.repairs.every((repair) => repair.changes === 1)).toBe(true);
  });

  it("breaks a consecutive run by changing one block", () => {
    const blocks = makeBlocks(2);
    const wards = rotation(blocks, "wards", "Wards", "ward", 0, 2, { maxConsecutive: 1 });
    const clinic = rotation(blocks, "clinic", "Clinic", "ambulatory", 0, 2);
    const sample = project({
      blocks,
      residents: [resident("a", "Avery Quinn")],
      rotations: [wards, clinic],
      assignments: [cell("a", "b01", "wards"), cell("a", "b02", "wards")],
    });
    const issue = validateSchedule(sample, sample.assignments).issues.find((item) => item.code === "consecutive");
    const plan = repairsForIssue(sample, issue!);
    expect(plan.repairs.length).toBeGreaterThan(0);
    expect(plan.repairs.every((repair) => repair.changes === 1)).toBe(true);
    expect(validateSchedule(sample, plan.repairs[0].assignments).ok).toBe(true);
  });
});
