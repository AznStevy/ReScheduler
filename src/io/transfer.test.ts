import { buildInternalMedicineDemo, snapshotOf } from "@/data/scenarios";
import { describe, expect, it } from "vitest";
import { exportIcs, exportProjectJson, exportScheduleCsv, exportWorkbook, importCsv, importProjectJson, importWorkbook } from "./transfer";

describe("project transfer", () => {
  it("round-trips a project through JSON", () => {
    const snapshot = snapshotOf(buildInternalMedicineDemo());
    snapshot.project.assignments.push({ residentId: "r01", blockId: "b01", rotationId: "wards", locked: true, source: "manual", duties: [{ date: "2026-07-02", name: "Clinic" }] });
    snapshot.project.blocks[0].locked = true;
    snapshot.project.residents[0].locked = true;
    const imported = importProjectJson(exportProjectJson(snapshot));
    expect(imported.errors).toEqual([]);
    expect(imported.snapshot?.project.residents).toHaveLength(60);
    expect(imported.snapshot?.project.assignments[0]?.locked).toBe(true);
    expect(imported.snapshot?.project.assignments.find((item) => item.locked)?.duties).toEqual([{ date: "2026-07-02", name: "Clinic" }]);
    expect(imported.snapshot?.project.blocks[0]?.locked).toBe(true);
    expect(imported.snapshot?.project.residents[0]?.locked).toBe(true);
  });

  it("rejects JSON that is not a project backup", () => {
    const imported = importProjectJson(JSON.stringify({ hello: "world" }));
    expect(imported.snapshot).toBeNull();
    expect(imported.errors[0]).toMatch(/not a ReScheduler/);
  });

  it("round-trips a project through an Excel workbook", () => {
    const snapshot = snapshotOf(buildInternalMedicineDemo());
    snapshot.audit.push({ id: "audit-1", at: "2026-11-12T00:00:00.000Z", action: "import", detail: "seed" });
    snapshot.project.assignments = [{ residentId: "r01", blockId: "b01", rotationId: "wards", locked: false, source: "manual", duties: [{ date: "2026-07-02", name: "Clinic" }] }];
    snapshot.project.blocks[0].locked = true;
    snapshot.project.residents[0].locked = true;
    const imported = importWorkbook(exportWorkbook(snapshot));
    expect(imported.errors).toEqual([]);
    expect(imported.snapshot?.project.residents.map((resident) => resident.id)).toEqual(snapshot.project.residents.map((resident) => resident.id));
    expect(imported.snapshot?.project.rotations.map((rotation) => rotation.id)).toEqual(snapshot.project.rotations.map((rotation) => rotation.id));
    expect(imported.snapshot?.project.requirements.map((requirement) => requirement.amount)).toEqual(snapshot.project.requirements.map((requirement) => requirement.amount));
    expect(imported.snapshot?.project.vacations).toHaveLength(snapshot.project.vacations.length);
    expect(imported.snapshot?.project.vacationRules.blackoutBlockIds).toEqual(["b13"]);
    expect(imported.snapshot?.project.blocks[0]?.locked).toBe(true);
    expect(imported.snapshot?.project.blocks[1]?.locked).toBeFalsy();
    expect(imported.snapshot?.project.residents[0]?.locked).toBe(true);
    expect(imported.snapshot?.project.residents[1]?.locked).toBeFalsy();
    expect(imported.snapshot?.audit[0]?.detail).toBe("seed");
    const ward = imported.snapshot?.project.rotations.find((rotation) => rotation.id === "wards");
    expect(ward?.staffing.find((cell) => cell.blockId === "b06")?.min).toBe(8);
    expect(imported.snapshot?.project.assignments).toEqual([
      { residentId: "r01", blockId: "b01", rotationId: "wards", locked: false, source: "manual", duties: [{ date: "2026-07-02", name: "Clinic" }] },
    ]);
  });

  it("round-trips the schedule grid through CSV and refuses a bad rotation", () => {
    const snapshot = snapshotOf(buildInternalMedicineDemo());
    snapshot.project.assignments = [{ residentId: "r01", blockId: "b01", rotationId: "wards", locked: false, source: "manual" }];
    const imported = importCsv(exportScheduleCsv(snapshot.project), snapshot);
    expect(imported.errors).toEqual([]);
    expect(imported.snapshot?.project.assignments).toEqual([
      { residentId: "r01", blockId: "b01", rotationId: "wards", locked: false, source: "import" },
    ]);
    const broken = importCsv("ResidentId,b01\nr01,not-a-rotation\n", snapshot);
    expect(broken.snapshot).toBeNull();
    expect(snapshot.project.assignments).toHaveLength(1);
  });

  it("restores staffing waivers, resident waivers, settings, history, and the color scheme", () => {
    const snapshot = snapshotOf(buildInternalMedicineDemo());
    snapshot.settings = { timeLimitSeconds: 12, randomSeed: 0, mipRelGap: 0.05, generateAlternatives: true };
    snapshot.project.staffingWaivers = [{
      id: "staff-1",
      blockId: "b01",
      rotationId: "wards",
      minReduction: 1,
      maxIncrease: 0,
      reason: "coverage; extra",
      grantedAt: "2026-11-01T00:00:00.000Z",
    }];
    const resident = snapshot.project.residents[0];
    if (!resident) throw new Error("missing resident");
    resident.waivers = [{
      id: "waiver-1",
      requirementId: "wards-experience",
      amount: 1,
      reason: "a:b;c",
      grantedAt: "2026-10-01T00:00:00.000Z",
    }];
    snapshot.project.assignments = [{ residentId: resident.id, blockId: "b01", rotationId: "wards", locked: true, source: "manual", duties: [{ date: "2026-07-02", name: "Clinic" }] }];
    snapshot.versions = [{ id: "v1", name: "Earlier", createdAt: "2026-11-01T00:00:00.000Z", assignments: snapshot.project.assignments, note: "x".repeat(40000) }];
    snapshot.audit = [{ id: "a1", at: "2026-11-12T00:00:00.000Z", action: "import", detail: "seed" }];
    const theme = { id: "custom" as const, custom: { sidebar: "#112233", steel: "#445566", paper: "#f7f8f6", card: "#ffffff", ink: "#25343d" } };
    const imported = importWorkbook(exportWorkbook(snapshot, theme));
    expect(imported.errors).toEqual([]);
    expect(imported.snapshot).toEqual(snapshot);
    expect(imported.theme).toEqual(theme);
    const fromJson = importProjectJson(exportProjectJson(snapshot, theme));
    expect(fromJson.errors).toEqual([]);
    expect(fromJson.snapshot).toEqual(snapshot);
    expect(fromJson.theme).toEqual(theme);
  });

  it("writes an ICS event for each assignment", () => {
    const snapshot = snapshotOf(buildInternalMedicineDemo());
    snapshot.project.assignments = [{ residentId: "r01", blockId: "b01", rotationId: "wards", locked: false, source: "manual" }];
    const ics = exportIcs(snapshot.project);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260701");
    expect(ics).toContain("General Medicine Wards");
  });
});
