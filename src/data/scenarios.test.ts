import { residentProgress } from "@/domain/progress";
import { diagnose } from "@/solver/diagnose";
import { buildModel } from "@/solver/model";
import { describe, expect, it } from "vitest";
import { buildImmutableConflict, buildInternalMedicineDemo, buildResolvableConflict } from "./scenarios";

describe("demonstration programs", () => {
  it("builds a 60-resident internal medicine year without an immutable structural conflict", () => {
    const project = buildInternalMedicineDemo();
    expect(project.residents).toHaveLength(60);
    expect(project.blocks).toHaveLength(13);
    expect(new Set(project.residents.map((resident) => resident.name)).size).toBe(60);
    expect(project.residents.some((resident) => resident.previousRotations.some((item) => item.rotationId === "micu" && item.blocks === 0))).toBe(false);
    expect(project.residents.find((resident) => resident.id === "r25")?.notes).toMatch(/no prior medical ICU/i);
    const senior = project.residents.find((resident) => resident.pgy === 3);
    const wards = residentProgress(project, senior!).find((item) => item.requirement.id === "wards-experience");
    expect(wards?.mustScheduleNow).toBe(2);
    const intern = project.residents.find((resident) => resident.pgy === 1);
    const emergency = residentProgress(project, intern!).find((item) => item.requirement.id === "em-intern");
    expect(emergency?.mustScheduleNow).toBe(1);
    const findings = diagnose(project).filter((finding) => finding.severity === "immutable");
    expect(findings).toEqual([]);
    const model = buildModel(project, { relax: false });
    expect(model.fatal).toBe(false);
    expect(model.stats.binaries).toBeGreaterThan(1000);
    expect(model.stats.warning).toBeNull();
  });

  it("keeps the resolvable conflict authorized and the staffing conflict immutable", () => {
    const resolvable = diagnose(buildResolvableConflict());
    expect(resolvable.some((finding) => finding.severity === "immutable")).toBe(false);
    const blocked = diagnose(buildImmutableConflict());
    expect(blocked.some((finding) => finding.severity === "immutable")).toBe(true);
  });
});
