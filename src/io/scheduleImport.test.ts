import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { importWorkbook } from "./transfer";
import { gridToSpans, projectFromSpans, readRequirement, wordsToSpans, type Word } from "./scheduleImport";

describe("schedule import", () => {
  it("reads a resident-by-block spreadsheet with dates", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Resident", "Block 1", "Block 2"],
      ["", "2026-07-01 to 2026-07-14", "July 15 to July 28"],
      ["Avery Stone", "Wards", "Vacation"],
      ["Blake Ibarra", "Clinic", "Wards"],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Schedule");
    const imported = importWorkbook(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer, "surgery-2026.xlsx");
    expect(imported.errors).toEqual([]);
    expect(imported.snapshot?.project.name).toBe("surgery-2026");
    expect(imported.snapshot?.project.residents.map((resident) => resident.name)).toEqual(["Avery Stone", "Blake Ibarra"]);
    expect(imported.snapshot?.project.blocks.map((block) => [block.startDate, block.endDate])).toEqual([
      ["2026-07-01", "2026-07-14"],
      ["2026-07-15", "2026-07-28"],
    ]);
    const avery = imported.snapshot?.project.residents[0];
    const vacation = imported.snapshot?.project.rotations.find((rotation) => rotation.name === "Vacation");
    expect(vacation?.category).toBe("vacation");
    expect(vacation?.eligiblePgy).toContain(7);
    expect(imported.snapshot?.project.assignments.find((item) => item.residentId === avery?.id && item.blockId === "b02")?.rotationId).toBe(vacation?.id);
  });

  it("rolls January into the next calendar year", () => {
    const parsed = gridToSpans([
      ["Resident", "13A", "13B"],
      ["", "December 16 to December 29", "December 30 to January 12"],
      ["Casey Okonkwo", "Wards", "Vacation"],
    ], { academicStartYear: 2025 });
    const built = projectFromSpans(parsed.spans, { name: "Year", people: parsed.people, asOfDate: "2025-07-01" });
    expect(built.project?.blocks.map((block) => [block.startDate, block.endDate])).toEqual([
      ["2025-12-16", "2025-12-29"],
      ["2025-12-30", "2026-01-12"],
    ]);
  });

  it("keeps the printed block dates when classes disagree by a day", () => {
    const built = projectFromSpans([
      { name: "Avery Stone", pgy: 1, rotation: "Wards", label: "1A", start: "2026-07-01", end: "2026-07-14" },
      { name: "Blake Ibarra", pgy: 2, rotation: "Wards", label: "1A", start: "2026-07-01", end: "2026-07-13" },
      { name: "Avery Stone", pgy: 1, rotation: "Clinic", label: "1B", start: "2026-07-15", end: "2026-07-28" },
      { name: "Blake Ibarra", pgy: 2, rotation: "Clinic", label: "1B", start: "2026-07-14", end: "2026-07-27" },
    ], { name: "Overlap", asOfDate: "2026-07-01" });
    expect(built.errors).toEqual([]);
    expect(built.project?.blocks.map((block) => [block.label, block.startDate, block.endDate])).toEqual([
      ["1A", "2026-07-01", "2026-07-14"],
      ["1B", "2026-07-15", "2026-07-28"],
    ]);
    expect(built.warnings.some((warning) => /printed on the first schedule/.test(warning))).toBe(true);
    const avery = built.project?.residents.find((resident) => resident.name === "Avery Stone");
    const wards = built.project?.rotations.find((rotation) => rotation.name === "Wards");
    expect(built.project?.assignments.find((item) => item.residentId === avery?.id && item.blockId === "b01")?.rotationId).toBe(wards?.id);
  });

  it("reads a positioned block table", () => {
    const words: Word[] = [];
    const columns = ["1A", "1B", "2A", "2B"];
    columns.forEach((label, index) => {
      const x = 100 + index * 70;
      words.push({ text: "BLOCK", x, y: 10, x2: x + 28, page: 1 });
      words.push({ text: label, x: x + 30, y: 10, x2: x + 48, page: 1 });
      words.push({ text: "July", x, y: 28, x2: x + 24, page: 1 }, { text: String(1 + index * 14), x: x + 26, y: 28, x2: x + 36, page: 1 });
      words.push({ text: "July", x, y: 40, x2: x + 24, page: 1 }, { text: String(14 + index * 14), x: x + 26, y: 40, x2: x + 36, page: 1 });
    });
    words.push({ text: "Avery", x: 10, y: 60, x2: 40, page: 1 }, { text: "Stone", x: 42, y: 60, x2: 70, page: 1 });
    words.push({ text: "Wards", x: 100, y: 60, x2: 140, page: 1 }, { text: "Clinic", x: 170, y: 60, x2: 210, page: 1 });
    const parsed = wordsToSpans(words, 2026);
    expect(parsed.people.map((person) => person.name)).toEqual(["Avery Stone"]);
    expect(parsed.spans.map((span) => span.rotation)).toEqual(["Wards", "Clinic"]);
    expect(parsed.spans[0]?.start).toBe("2026-07-01");
  });

  it("reads a QGenda staff grid as one block per week", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Sample Hospital Medicine"],
      ["Printed: 11/13/2026 12:00 PM"],
      [],
      ["", "Nov-26", "", "", "", "", "", "", "Dec-26"],
      ["", "9", "10", "11", "12", "13", "14", "15", "1"],
      ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Tue"],
      ["Stone, Avery", "Team A Intern", "Team A Intern", "", "Team A Intern", "", "", "", "Vacation"],
      ["", "", "", "", "Clinic North", "", "", "", ""],
      ["Ibarra, Blake", "Night Float", "Night Float", "", "", "", "", "Ambulatory", ""],
      ["Cho, Casey", "Team B Resident", "Team B Resident", "Team B Resident", "", "", "", "", ""],
      ["Ng, Drew", "Wards", "Wards", "Wards", "Wards", "Wards", "", "", ""],
      ["", "Clinic", "Clinic", "Clinic", "Clinic", "Clinic", "", "", ""],
      ["Schedule Notes:"],
      ["11/9/2026 Mon Stone, Avery should stay out"],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Page 1");
    const imported = importWorkbook(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer, "Grid By Staff.xlsx");
    expect(imported.errors).toEqual([]);
    const project = imported.snapshot?.project;
    expect(project?.name).toBe("Sample Hospital Medicine");
    expect(project?.residents.map((resident) => [resident.name, resident.pgy])).toEqual([
      ["Stone, Avery", 1],
      ["Ibarra, Blake", 1],
      ["Cho, Casey", 2],
      ["Ng, Drew", 1],
    ]);
    expect(project?.blocks[0]).toMatchObject({ label: "Nov 9 – Nov 15", startDate: "2026-11-09", endDate: "2026-11-15" });
    expect(project?.blocks.at(-1)).toMatchObject({ label: "Dec 1", startDate: "2026-12-01", endDate: "2026-12-01" });
    const avery = project?.residents[0];
    const week = project?.blocks[0];
    const averyAssignment = project?.assignments.find((item) => item.residentId === avery?.id && item.blockId === week?.id);
    const assignment = project?.rotations.find((rotation) => rotation.id === averyAssignment?.rotationId);
    expect(assignment?.name).toBe("Team A Intern");
    expect(assignment?.category).toBe("ward");
    expect(averyAssignment?.duties).toEqual([{ date: "2026-11-12", name: "Clinic North" }]);
    const drew = project?.residents.find((resident) => resident.name === "Ng, Drew");
    const drewAssignment = project?.assignments.find((item) => item.residentId === drew?.id && item.blockId === week?.id);
    expect(project?.rotations.find((rotation) => rotation.id === drewAssignment?.rotationId)?.name).toBe("Wards");
    expect(drewAssignment?.duties?.map((duty) => duty.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(drewAssignment?.duties?.every((duty) => duty.name === "Clinic")).toBe(true);
    expect(project?.rotations.map((rotation) => rotation.name).sort()).toEqual(["Night Float", "Team A Intern", "Team B Resident", "Vacation", "Wards"]);
    expect(imported.warnings.some((warning) => /same week/.test(warning))).toBe(true);
    expect(imported.warnings.some((warning) => /more than one shift/.test(warning))).toBe(true);
    expect(imported.warnings.some((warning) => /same day/.test(warning))).toBe(true);
  });

  it("turns a sentence into a requirement for the rotations it names", () => {
    const read = readRequirement("PGY-2 residents need 2 clinic blocks", [
      { id: "clinic", name: "Clinic" },
      { id: "wards", name: "Wards" },
    ]);
    expect(read.amount).toBe(2);
    expect(read.unit).toBe("blocks");
    expect(read.scope).toBe("pgy");
    expect(read.appliesTo.pgy).toEqual([2]);
    expect(read.rotationIds).toEqual(["clinic"]);
    expect(read.note).toBe("");
  });

  it("keeps unmatched text from becoming a rule", () => {
    const read = readRequirement("Everyone should have a research month", [{ id: "clinic", name: "Clinic" }]);
    expect(read.rotationIds).toEqual([]);
    expect(read.note).toMatch(/No rotation/);
  });
});
