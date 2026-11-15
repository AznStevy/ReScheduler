import {
  buildEmptyProject,
  defaultSettings,
  snapshotOf,
} from "@/data/scenarios";
import { academicYearFromName, gridToSpans, projectFromSpans, qgendaGridToSpans, titleFromFile, wordsToSpans, type LooseSpan, type PersonSeed } from "@/io/scheduleImport";
import type {
  Assignment,
  DayDuty,
  AuditEntry,
  Block,
  OptimizationSettings,
  Project,
  Requirement,
  RequirementScope,
  Resident,
  Rotation,
  RotationCategory,
  ScheduleVersion,
  Snapshot,
  StaffingWaiver,
  VacationRequest,
  Waiver,
} from "@/domain/types";
import { SCHEMES, type CustomColors, type ThemeChoice } from "@/ui/theme";
import * as XLSX from "xlsx";

export interface TransferResult {
  snapshot: Snapshot | null;
  errors: string[];
  warnings: string[];
  theme?: ThemeChoice | null;
}

const CATEGORIES: RotationCategory[] = ["ward", "icu", "night", "ambulatory", "emergency", "elective", "research", "vacation", "other"];
const SCOPES: RequirementScope[] = ["accreditation", "institutional", "program", "pgy", "track", "individual"];

export function exportProjectJson(snapshot: Snapshot, theme?: ThemeChoice | null): string {
  return JSON.stringify(
    {
      format: "rescheduler-project",
      version: 1,
      exportedAt: new Date().toISOString(),
      snapshot,
      ...(theme ? { theme } : {}),
    },
    null,
    2,
  );
}

export function importProjectJson(text: string): TransferResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { snapshot: null, errors: ["The file is not valid JSON."], warnings: [] };
  }
  if (!parsed || typeof parsed !== "object") return { snapshot: null, errors: ["The file is not a ReScheduler backup."], warnings: [] };
  const envelope = parsed as { format?: string; version?: number; snapshot?: Snapshot; theme?: unknown };
  if (envelope.format !== "rescheduler-project" || envelope.version !== 1 || !envelope.snapshot) {
    return { snapshot: null, errors: ["This JSON file is not a ReScheduler project backup (format version 1)."], warnings: [] };
  }
  const accepted = acceptSnapshot(envelope.snapshot, []);
  const theme = themeFromExport(envelope.theme);
  return theme ? { ...accepted, theme } : accepted;
}

export function exportWorkbook(snapshot: Snapshot, theme?: ThemeChoice | null): ArrayBuffer {
  const book = XLSX.utils.book_new();
  const project = snapshot.project;
  add(book, "Project", [
    ["key", "value"],
    ["id", project.id],
    ["name", project.name],
    ["academicYear", project.academicYear],
    ["asOfDate", project.asOfDate],
    ["blockWeeks", project.blockWeeks],
    ["scenarioNote", project.scenarioNote],
    ["syntheticDemo", project.syntheticDemo ? "true" : "false"],
    ["defaultCapacity", project.vacationRules.defaultCapacity],
    ["blackoutBlockIds", project.vacationRules.blackoutBlockIds.join(",")],
    ["capacityByBlock", project.vacationRules.capacityByBlock.map((item) => `${item.blockId}:${item.capacity}`).join("; ")],
    ["timeLimitSeconds", snapshot.settings.timeLimitSeconds],
    ["randomSeed", snapshot.settings.randomSeed ?? ""],
    ["mipRelGap", snapshot.settings.mipRelGap],
    ["generateAlternatives", snapshot.settings.generateAlternatives ? "true" : "false"],
    ["theme", theme ? JSON.stringify(theme) : ""],
  ]);
  add(book, "Blocks", [
    ["id", "label", "startDate", "endDate", "holiday", "index", "locked"],
    ...project.blocks.map((block) => [block.id, block.label, block.startDate, block.endDate, block.holiday ? "true" : "false", block.index, block.locked ? "true" : "false"]),
  ]);
  add(book, "Interests", [
    ["id", "name"],
    ...project.interests.map((interest) => [interest.id, interest.name]),
  ]);
  add(book, "Residents", [
    ["id", "name", "pgy", "track", "startDate", "graduationDate", "restrictions", "notes", "previous", "interests", "electives", "icu", "nights", "wards", "holiday", "locks", "waivers", "scheduleLocked"],
    ...project.residents.map((resident) => [
      resident.id,
      resident.name,
      resident.pgy,
      resident.track,
      resident.startDate,
      resident.graduationDate,
      resident.restrictions.join(","),
      resident.notes,
      resident.previousRotations.map((item) => `${item.rotationId}:${item.blocks}`).join("; "),
      resident.careerInterests.map((item) => `${item.interestId}:${item.rank}`).join("; "),
      resident.electivePreferences.map((item) => `${item.rotationId}:${item.rank}`).join("; "),
      resident.historicalBurden.icu,
      resident.historicalBurden.nights,
      resident.historicalBurden.wards,
      resident.historicalBurden.holiday,
      resident.lockedAssignments.map((item) => `${item.blockId}:${item.rotationId}`).join("; "),
      resident.waivers.length ? JSON.stringify(resident.waivers) : "",
      resident.locked ? "true" : "false",
    ]),
  ]);
  add(book, "Rotations", [
    ["id", "name", "category", "durationBlocks", "eligiblePgy", "eligibleTracks", "workloadIntensity", "maxConsecutive", "maxBlocksPerResident", "noConsecutiveCategories", "prerequisites", "availableBlocks", "relaxStaffingMin", "relaxStaffingMax", "staffingPriority", "color", "careerRelevance", "requirementCredits"],
    ...project.rotations.map((rotation) => [
      rotation.id,
      rotation.name,
      rotation.category,
      rotation.durationBlocks,
      rotation.eligiblePgy.join(","),
      rotation.eligibleTracks.join(","),
      rotation.workloadIntensity,
      rotation.maxConsecutive ?? "",
      rotation.maxBlocksPerResident ?? "",
      rotation.noConsecutiveCategories.join(","),
      rotation.prerequisites.map((item) => `${item.rotationId}:${item.blocks}`).join("; "),
      rotation.availableBlocks.join(","),
      rotation.relaxStaffingMin,
      rotation.relaxStaffingMax,
      rotation.staffingPriority,
      rotation.color,
      rotation.careerRelevance.map((item) => `${item.interestId}:${item.score}`).join("; "),
      rotation.requirementCredits.map((item) => `${item.requirementId}:${item.credits}`).join("; "),
    ]),
  ]);
  add(book, "Staffing", [
    ["rotationId", "blockId", "min", "max"],
    ...project.rotations.flatMap((rotation) => rotation.staffing.map((cell) => [rotation.id, cell.blockId, cell.min, cell.max])),
  ]);
  add(book, "Requirements", [
    ["id", "name", "description", "scope", "unit", "amount", "appliesTo", "rotationIds", "deadlineBlockId", "priority", "relaxable", "maxRelaxation", "maxPerYear"],
    ...project.requirements.map((requirement) => [
      requirement.id,
      requirement.name,
      requirement.description,
      requirement.scope,
      requirement.unit,
      requirement.amount,
      formatApplies(requirement),
      requirement.rotationIds.join(","),
      requirement.deadlineBlockId ?? "",
      requirement.priority,
      requirement.relaxable ? "true" : "false",
      requirement.maxRelaxation,
      requirement.maxPerYear ?? "",
    ]),
  ]);
  add(book, "Vacations", [
    ["id", "residentId", "blockId", "rank", "status", "alternatives"],
    ...project.vacations.map((vacation) => [vacation.id, vacation.residentId, vacation.blockId, vacation.rank, vacation.status, vacation.alternatives.join(",")]),
  ]);
  add(book, "Assignments", [
    ["residentId", "blockId", "rotationId", "locked", "source", "duties"],
    ...project.assignments.map((assignment) => [assignment.residentId, assignment.blockId, assignment.rotationId, assignment.locked ? "true" : "false", assignment.source, assignment.duties?.length ? JSON.stringify(assignment.duties) : ""]),
  ]);
  add(book, "StaffingWaivers", [
    ["id", "blockId", "rotationId", "minReduction", "maxIncrease", "reason", "grantedAt"],
    ...project.staffingWaivers.map((waiver) => [waiver.id, waiver.blockId, waiver.rotationId, waiver.minReduction, waiver.maxIncrease, waiver.reason, waiver.grantedAt]),
  ]);
  add(book, "History", [
    ["kind", "part", "json"],
    ...snapshot.versions.flatMap((version) => jsonParts("version", version)),
    ...snapshot.audit.flatMap((entry) => jsonParts("audit", entry)),
  ]);
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

export function importWorkbook(data: ArrayBuffer, fileName = ""): TransferResult {
  const book = XLSX.read(data, { type: "array" });
  if (!isSchedulerWorkbook(book)) return importLooseWorkbook(book, fileName);
  const errors: string[] = [];
  const warnings: string[] = [];
  const meta = Object.fromEntries(rows(book, "Project").map((row) => [cell(row, "key"), cell(row, "value")]));
  const blocks = rows(book, "Blocks").map((row, index) => {
    const block: Block = {
      id: required(row, "id", `Blocks row ${index + 2}`, errors),
      index: numberOr(cell(row, "index"), index),
      label: cell(row, "label") || `Block ${index + 1}`,
      startDate: required(row, "startDate", `Blocks row ${index + 2}`, errors),
      endDate: required(row, "endDate", `Blocks row ${index + 2}`, errors),
      holiday: bool(cell(row, "holiday")),
      ...(bool(cell(row, "locked")) ? { locked: true } : {}),
    };
    return block;
  });
  const interests = rows(book, "Interests").map((row) => ({ id: cell(row, "id"), name: cell(row, "name") })).filter((item) => item.id && item.name);
  const residents = rows(book, "Residents").map((row, index) => residentFromRow(row, index, errors));
  const rotations = rows(book, "Rotations").map((row, index) => rotationFromRow(row, index, errors));
  const staffing = rows(book, "Staffing");
  for (const rotation of rotations) {
    const cellsForRotation = staffing.filter((row) => cell(row, "rotationId") === rotation.id);
    if (cellsForRotation.length) {
      rotation.staffing = cellsForRotation.map((row) => ({
        blockId: cell(row, "blockId"),
        min: numberOr(cell(row, "min"), 0),
        max: numberOr(cell(row, "max"), 0),
      }));
    }
  }
  const requirements = rows(book, "Requirements").map((row, index) => requirementFromRow(row, index, errors));
  const vacations = rows(book, "Vacations").map((row, index) => vacationFromRow(row, index, errors));
  const assignments = rows(book, "Assignments").map((row, index) => assignmentFromRow(row, index, errors));
  const versions: ScheduleVersion[] = [];
  const audit: AuditEntry[] = [];
  let historyKind = "";
  let historyParts: string[] = [];
  const finishHistory = () => {
    if (!historyParts.length) return;
    const json = historyParts.join("");
    historyParts = [];
    try {
      if (historyKind === "audit") audit.push(JSON.parse(json) as AuditEntry);
      else versions.push(JSON.parse(json) as ScheduleVersion);
    } catch {
      warnings.push("A history row was skipped because its JSON was unreadable.");
    }
  };
  for (const row of rows(book, "History")) {
    const json = cellRaw(row, "json");
    if (!json) continue;
    const kind = cell(row, "kind") === "audit" ? "audit" : "version";
    const part = cell(row, "part");
    const startsRecord = part === "" || part === "0";
    if (startsRecord) finishHistory();
    historyKind = kind;
    historyParts.push(json);
  }
  finishHistory();
  if (errors.length) return { snapshot: null, errors, warnings };
  const staffingWaivers = rows(book, "StaffingWaivers").map((row, index) => staffingWaiverFromRow(row, index, errors));
  if (errors.length) return { snapshot: null, errors, warnings };
  const project: Project = {
    ...buildEmptyProject(),
    id: meta.id || "imported",
    name: meta.name || "Imported program",
    academicYear: meta.academicYear || "2026-2027",
    asOfDate: meta.asOfDate || blocks[0]?.startDate || "2026-07-01",
    blockWeeks: numberOr(meta.blockWeeks, 4),
    blocks,
    interests,
    residents,
    rotations,
    requirements,
    vacations,
    assignments,
    vacationRules: {
      defaultCapacity: numberOr(meta.defaultCapacity, 0),
      blackoutBlockIds: splitList(meta.blackoutBlockIds ?? ""),
      capacityByBlock: splitPairs(meta.capacityByBlock ?? "").map(([blockId, capacity]) => ({ blockId, capacity: Number(capacity) })),
    },
    scenarioNote: meta.scenarioNote ?? "",
    syntheticDemo: bool(meta.syntheticDemo ?? "false"),
    staffingWaivers,
  };
  const settings: OptimizationSettings = {
    ...defaultSettings(),
    timeLimitSeconds: numberOr(meta.timeLimitSeconds, defaultSettings().timeLimitSeconds),
    randomSeed: meta.randomSeed == null || meta.randomSeed === "" ? null : numberOr(meta.randomSeed, 1),
    mipRelGap: numberOr(meta.mipRelGap, 0),
    generateAlternatives: bool(meta.generateAlternatives ?? "false"),
  };
  const accepted = acceptSnapshot({ project, versions, audit, settings }, warnings);
  const theme = themeFromExport(meta.theme);
  return theme ? { ...accepted, theme } : accepted;
}

export function exportScheduleCsv(project: Project): string {
  const header = ["ResidentId", "Resident", "PGY", "Track", ...project.blocks.map((block) => block.id)];
  const body = project.residents.map((resident) => [
    resident.id,
    resident.name,
    String(resident.pgy),
    resident.track,
    ...project.blocks.map((block) => project.assignments.find((item) => item.residentId === resident.id && item.blockId === block.id)?.rotationId ?? ""),
  ]);
  return XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet([header, ...body]));
}

export function exportResidentsCsv(project: Project): string {
  const book = XLSX.read(exportWorkbook(snapshotOf(project)), { type: "array" });
  return XLSX.utils.sheet_to_csv(book.Sheets.Residents);
}

export function importCsv(text: string, current: Snapshot): TransferResult {
  const sheet = XLSX.read(text, { type: "string" }).Sheets.Sheet1;
  if (!sheet) return { snapshot: null, errors: ["The CSV file is empty."], warnings: [] };
  const table = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (!table.length) return { snapshot: null, errors: ["The CSV file has no data rows."], warnings: [] };
  const headers = Object.keys(table[0]).map((header) => header.toLowerCase());
  if (headers.includes("startdate") || headers.includes("graduationdate")) {
    const errors: string[] = [];
    const residents = table.map((row, index) => residentFromRow(row, index, errors));
    if (errors.length) return { snapshot: null, errors, warnings: [] };
    return acceptSnapshot({ ...current, project: { ...current.project, residents } }, ["Residents were replaced from the CSV. Rotations, requirements, and assignments were left as they are."]);
  }
  const blockColumns = Object.keys(table[0]).filter((header) => current.project.blocks.some((block) => block.id === header || block.label === header));
  if (!blockColumns.length) {
    return { snapshot: null, errors: ["The CSV is neither a resident list nor a schedule grid. Use the Excel workbook for a full project."], warnings: [] };
  }
  const errors: string[] = [];
  const kept = current.project.assignments.filter((assignment) => !table.some((row) => cell(row, "ResidentId") === assignment.residentId || cell(row, "id") === assignment.residentId));
  const assignments: Assignment[] = [...kept];
  table.forEach((row, index) => {
    const residentId = cell(row, "ResidentId") || cell(row, "id");
    if (!current.project.residents.some((resident) => resident.id === residentId)) {
      errors.push(`CSV row ${index + 2} refers to unknown resident ${residentId || "(blank)"}.`);
      return;
    }
    for (const header of blockColumns) {
      const block = current.project.blocks.find((item) => item.id === header || item.label === header);
      const rotationId = cell(row, header);
      if (!block || !rotationId) continue;
      const rotation = current.project.rotations.find((item) => item.id === rotationId || item.name === rotationId);
      if (!rotation) {
        errors.push(`${residentId} ${header} has unknown rotation "${rotationId}".`);
        continue;
      }
      assignments.push({ residentId, blockId: block.id, rotationId: rotation.id, locked: false, source: "import" });
    }
  });
  if (errors.length) return { snapshot: null, errors, warnings: [] };
  return acceptSnapshot({ ...current, project: { ...current.project, assignments } }, []);
}

export function exportIcs(project: Project): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ReScheduler//EN", "CALSCALE:GREGORIAN"];
  for (const assignment of project.assignments) {
    const resident = project.residents.find((item) => item.id === assignment.residentId);
    const rotation = project.rotations.find((item) => item.id === assignment.rotationId);
    const block = project.blocks.find((item) => item.id === assignment.blockId);
    if (!resident || !rotation || !block) continue;
    const end = nextDay(block.endDate);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${assignment.residentId}-${assignment.blockId}@rescheduler`,
      `DTSTART;VALUE=DATE:${block.startDate.replaceAll("-", "")}`,
      `DTEND;VALUE=DATE:${end.replaceAll("-", "")}`,
      `SUMMARY:${icsText(resident.name)} — ${icsText(rotation.name)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function acceptSnapshot(snapshot: Snapshot, warnings: string[]): TransferResult {
  const errors = validateSnapshot(snapshot);
  if (errors.length) return { snapshot: null, errors, warnings };
  return { snapshot, errors: [], warnings };
}

function validateSnapshot(snapshot: Snapshot): string[] {
  const errors: string[] = [];
  const project = snapshot.project;
  if (!project || project.formatVersion !== 1) errors.push("The project format version is missing or unsupported.");
  if (!project?.blocks?.length) errors.push("The project needs at least one scheduling block.");
  const ids = (values: { id: string }[], label: string) => {
    const seen = new Set<string>();
    for (const value of values) {
      if (!value.id) errors.push(`A ${label} is missing an id.`);
      else if (seen.has(value.id)) errors.push(`Duplicate ${label} id ${value.id}.`);
      seen.add(value.id);
    }
  };
  if (!project) return errors;
  ids(project.blocks, "block");
  ids(project.residents, "resident");
  ids(project.rotations, "rotation");
  ids(project.requirements, "requirement");
  ids(project.interests, "interest");
  const blockIds = new Set(project.blocks.map((block) => block.id));
  const residentIds = new Set(project.residents.map((resident) => resident.id));
  const rotationIds = new Set(project.rotations.map((rotation) => rotation.id));
  for (const rotation of project.rotations) {
    if (!CATEGORIES.includes(rotation.category)) errors.push(`${rotation.name} has an unknown category.`);
    for (const cell of rotation.staffing) {
      if (!blockIds.has(cell.blockId)) errors.push(`${rotation.name} staffing refers to unknown block ${cell.blockId}.`);
      if (cell.min > cell.max) errors.push(`${rotation.name} has a minimum above its maximum in ${cell.blockId}.`);
    }
  }
  for (const resident of project.residents) {
    if (!Number.isInteger(resident.pgy) || resident.pgy < 1) errors.push(`${resident.name || resident.id} needs a PGY of 1 or higher.`);
    for (const lock of resident.lockedAssignments) {
      if (!blockIds.has(lock.blockId) || !rotationIds.has(lock.rotationId)) errors.push(`${resident.name} has a lock pointing at a missing block or rotation.`);
    }
  }
  for (const vacation of project.vacations) {
    if (!residentIds.has(vacation.residentId) || !blockIds.has(vacation.blockId)) errors.push(`Vacation ${vacation.id} points at a missing resident or block.`);
    if (vacation.status !== "approved" && vacation.status !== "pending") errors.push(`Vacation ${vacation.id} must be approved or pending.`);
  }
  const seen = new Set<string>();
  for (const assignment of project.assignments) {
    const key = `${assignment.residentId}|${assignment.blockId}`;
    if (seen.has(key)) errors.push(`More than one assignment for ${assignment.residentId} in ${assignment.blockId}.`);
    seen.add(key);
    if (!residentIds.has(assignment.residentId) || !blockIds.has(assignment.blockId) || !rotationIds.has(assignment.rotationId)) {
      errors.push(`Assignment ${key} points at a missing resident, block, or rotation.`);
    }
  }
  return errors;
}

function residentFromRow(row: Record<string, unknown>, index: number, errors: string[]): Resident {
  const where = `Residents row ${index + 2}`;
  return {
    id: required(row, "id", where, errors),
    name: required(row, "name", where, errors),
    pgy: numberOr(cell(row, "pgy"), 0),
    track: cell(row, "track") || "Categorical",
    startDate: required(row, "startDate", where, errors),
    graduationDate: required(row, "graduationDate", where, errors),
    restrictions: splitList(cell(row, "restrictions")),
    notes: cell(row, "notes"),
    previousRotations: splitPairs(cell(row, "previous")).map(([rotationId, blocks]) => ({ rotationId, blocks: Number(blocks) })),
    careerInterests: splitPairs(cell(row, "interests")).map(([interestId, rank]) => ({ interestId, rank: Number(rank) })),
    electivePreferences: splitPairs(cell(row, "electives")).map(([rotationId, rank]) => ({ rotationId, rank: Number(rank) })),
    historicalBurden: {
      icu: numberOr(cell(row, "icu"), 0),
      nights: numberOr(cell(row, "nights"), 0),
      wards: numberOr(cell(row, "wards"), 0),
      holiday: numberOr(cell(row, "holiday"), 0),
    },
    lockedAssignments: splitPairs(cell(row, "locks")).map(([blockId, rotationId]) => ({ blockId, rotationId })),
    waivers: waiversFromCell(cell(row, "waivers"), index),
    ...(bool(cell(row, "scheduleLocked")) ? { locked: true } : {}),
  };
}

function rotationFromRow(row: Record<string, unknown>, index: number, errors: string[]): Rotation {
  const where = `Rotations row ${index + 2}`;
  const category = cell(row, "category") as RotationCategory;
  const eligiblePgy = splitList(cell(row, "eligiblePgy")).map(Number).filter((value) => Number.isInteger(value));
  return {
    id: required(row, "id", where, errors),
    name: required(row, "name", where, errors),
    category,
    durationBlocks: Math.max(1, numberOr(cell(row, "durationBlocks"), 1)),
    eligiblePgy: eligiblePgy.length ? eligiblePgy : [1, 2, 3, 4, 5, 6, 7, 8],
    eligibleTracks: splitList(cell(row, "eligibleTracks")),
    staffing: [],
    requirementCredits: splitPairs(cell(row, "requirementCredits")).map(([requirementId, credits]) => ({ requirementId, credits: Number(credits) })),
    careerRelevance: splitPairs(cell(row, "careerRelevance")).map(([interestId, score]) => ({ interestId, score: Number(score) })),
    workloadIntensity: numberOr(cell(row, "workloadIntensity"), 1),
    maxConsecutive: optionalNumber(cell(row, "maxConsecutive")),
    maxBlocksPerResident: optionalNumber(cell(row, "maxBlocksPerResident")),
    noConsecutiveCategories: splitList(cell(row, "noConsecutiveCategories")).filter((item): item is RotationCategory => CATEGORIES.includes(item as RotationCategory)),
    prerequisites: splitPairs(cell(row, "prerequisites")).map(([rotationId, blocks]) => ({ rotationId, blocks: Number(blocks) })),
    availableBlocks: splitList(cell(row, "availableBlocks")),
    relaxStaffingMin: numberOr(cell(row, "relaxStaffingMin"), 0),
    relaxStaffingMax: numberOr(cell(row, "relaxStaffingMax"), 0),
    staffingPriority: numberOr(cell(row, "staffingPriority"), 0),
    color: cell(row, "color") || "#335566",
  };
}

function requirementFromRow(row: Record<string, unknown>, index: number, errors: string[]): Requirement {
  const where = `Requirements row ${index + 2}`;
  const scope = cell(row, "scope") as RequirementScope;
  if (scope && !SCOPES.includes(scope)) errors.push(`${where} has an unknown scope.`);
  const unit = cell(row, "unit") === "weeks" ? "weeks" : "blocks";
  return {
    id: required(row, "id", where, errors),
    name: required(row, "name", where, errors),
    description: cell(row, "description"),
    scope: SCOPES.includes(scope) ? scope : "program",
    unit,
    amount: numberOr(cell(row, "amount"), 0),
    appliesTo: parseApplies(cell(row, "appliesTo")),
    rotationIds: splitList(cell(row, "rotationIds")),
    deadlineBlockId: cell(row, "deadlineBlockId") || null,
    priority: numberOr(cell(row, "priority"), 1),
    relaxable: bool(cell(row, "relaxable")),
    maxRelaxation: numberOr(cell(row, "maxRelaxation"), 0),
    maxPerYear: optionalNumber(cell(row, "maxPerYear")),
  };
}

function vacationFromRow(row: Record<string, unknown>, index: number, errors: string[]): VacationRequest {
  const where = `Vacations row ${index + 2}`;
  const status = cell(row, "status");
  return {
    id: required(row, "id", where, errors) || `vac-${index}`,
    residentId: required(row, "residentId", where, errors),
    blockId: required(row, "blockId", where, errors),
    rank: numberOr(cell(row, "rank"), 1),
    status: status === "approved" ? "approved" : "pending",
    alternatives: splitList(cell(row, "alternatives")),
  };
}

function assignmentFromRow(row: Record<string, unknown>, index: number, errors: string[]): Assignment {
  const where = `Assignments row ${index + 2}`;
  const source = cell(row, "source");
  const duties = dutiesFromCell(cell(row, "duties"), where, errors);
  return {
    residentId: required(row, "residentId", where, errors),
    blockId: required(row, "blockId", where, errors),
    rotationId: required(row, "rotationId", where, errors),
    locked: bool(cell(row, "locked")),
    source: source === "optimizer" || source === "manual" || source === "locked" || source === "import" ? source : "import",
    ...(duties?.length ? { duties } : {}),
  };
}

function dutiesFromCell(value: string, where: string, errors: string[]): DayDuty[] | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    errors.push(`${where} has unreadable day shifts.`);
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    errors.push(`${where} has unreadable day shifts.`);
    return undefined;
  }
  const duties: DayDuty[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const date = "date" in item && typeof item.date === "string" ? item.date : "";
    const name = "name" in item && typeof item.name === "string" ? item.name.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) continue;
    duties.push({ date, name });
  }
  return duties;
}

function formatApplies(requirement: Requirement): string {
  const parts: string[] = [];
  if (requirement.appliesTo.all) parts.push("all");
  if (requirement.appliesTo.pgy?.length) parts.push(`pgy=${requirement.appliesTo.pgy.join(",")}`);
  if (requirement.appliesTo.tracks?.length) parts.push(`tracks=${requirement.appliesTo.tracks.join(",")}`);
  if (requirement.appliesTo.residentIds?.length) parts.push(`residents=${requirement.appliesTo.residentIds.join(",")}`);
  return parts.join("; ") || "all";
}

function parseApplies(value: string): Requirement["appliesTo"] {
  if (!value || value === "all") return { all: true };
  const applies: Requirement["appliesTo"] = {};
  for (const part of value.split(";").map((item) => item.trim()).filter(Boolean)) {
    if (part === "all") applies.all = true;
    const [key, raw] = part.split("=");
    const list = splitList(raw ?? "");
    if (key === "pgy") applies.pgy = list.map(Number);
    if (key === "tracks") applies.tracks = list;
    if (key === "residents") applies.residentIds = list;
  }
  return applies;
}

function add(book: XLSX.WorkBook, name: string, data: (string | number)[][]) {
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(data), name);
}

function isSchedulerWorkbook(book: XLSX.WorkBook): boolean {
  const sheet = book.Sheets.Project;
  if (!sheet) return false;
  const table = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return table.some((row) => Object.keys(row).some((key) => key.trim().toLowerCase() === "key" && String(row[key] ?? "").trim() !== ""));
}

function importLooseWorkbook(book: XLSX.WorkBook, fileName: string): TransferResult {
  const warnings: string[] = [];
  const spans: LooseSpan[] = [];
  const people: PersonSeed[] = [];
  let accepted = 0;
  const titles: string[] = [];
  const year = academicYearFromName(fileName);
  for (const sheetName of book.SheetNames) {
    const matrix = sheetMatrix(book.Sheets[sheetName]);
    const qgenda = qgendaGridToSpans(matrix);
    if (qgenda) {
      if (!qgenda.people.length && !qgenda.spans.length) {
        if (book.SheetNames.length === 1) return { snapshot: null, errors: qgenda.errors, warnings: qgenda.warnings };
        warnings.push(qgenda.errors[0] ?? `${sheetName}: No staff names were found in the QGenda grid.`);
        continue;
      }
      accepted += 1;
      spans.push(...qgenda.spans);
      people.push(...qgenda.people);
      warnings.push(...qgenda.warnings);
      if (qgenda.title) titles.push(qgenda.title);
      continue;
    }
    const parsed = gridToSpans(matrix, { academicStartYear: year, sheetName });
    if (!parsed.people.length && !parsed.spans.length) {
      if (book.SheetNames.length === 1 && parsed.errors.length) return { snapshot: null, errors: parsed.errors, warnings: parsed.warnings };
      if (parsed.errors.length) warnings.push(parsed.errors[0]);
      continue;
    }
    accepted += 1;
    spans.push(...parsed.spans);
    people.push(...parsed.people);
    warnings.push(...parsed.warnings);
  }
  if (!accepted) return { snapshot: null, errors: ["No schedule grid was found. Use a QGenda staff grid, resident names across block or date columns, or a ReScheduler workbook."], warnings };
  const built = projectFromSpans(spans, { name: titles.length === 1 ? titles[0] : titleFromFile(fileName), people, warnings });
  if (!built.project) return { snapshot: null, errors: built.errors, warnings: built.warnings };
  return acceptSnapshot(snapshotOf(built.project), built.warnings);
}

function sheetMatrix(sheet: XLSX.WorkSheet): string[][] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
  return rows.map((row) => (Array.isArray(row) ? row : []).map(cellText));
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  return String(value).replace(/\s+/g, " ").trim();
}

export async function importPdfSchedule(data: ArrayBuffer, fileName: string): Promise<TransferResult> {
  try {
    const { wordsFromPdf } = await import("@/io/pdfSchedule");
    const words = await wordsFromPdf(data);
    if (words.length < 20) {
      return { snapshot: null, errors: ["This PDF has no text layer. Export the schedule to Excel, or use a PDF that was generated from a spreadsheet rather than a scan."], warnings: [] };
    }
    const parsed = wordsToSpans(words, academicYearFromName(fileName));
    const built = projectFromSpans(parsed.spans, { name: titleFromFile(fileName), people: parsed.people, warnings: parsed.warnings });
    if (!built.project) return { snapshot: null, errors: built.errors, warnings: built.warnings };
    return acceptSnapshot(snapshotOf(built.project), built.warnings);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return { snapshot: null, errors: [`The PDF could not be read. ${detail}`], warnings: [] };
  }
}

function rows(book: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  const sheet = book.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

function cell(row: Record<string, unknown>, key: string): string {
  const value = cellRaw(row, key);
  return value.trim();
}

function cellRaw(row: Record<string, unknown>, key: string): string {
  const found = Object.entries(row).find(([name]) => name.trim().toLowerCase() === key.toLowerCase());
  if (!found || found[1] == null) return "";
  return String(found[1]);
}

function required(row: Record<string, unknown>, key: string, where: string, errors: string[]): string {
  const value = cell(row, key);
  if (!value) errors.push(`${where} is missing ${key}.`);
  return value;
}

function numberOr(value: string | undefined, fallback: number): number {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value: string): boolean {
  return ["true", "yes", "1"].includes(value.toLowerCase());
}

function splitList(value: string): string[] {
  return value.split(/[,;]/).map((item) => item.trim()).filter(Boolean);
}

function splitPairs(value: string): [string, string][] {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [left, right] = item.split(":");
      return [(left ?? "").trim(), (right ?? "").trim()] as [string, string];
    })
    .filter(([left]) => left);
}

function splitTriples(value: string): [string, string, string][] {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [left, middle, ...rest] = item.split(":");
      return [(left ?? "").trim(), (middle ?? "").trim(), rest.join(":").trim()] as [string, string, string];
    })
    .filter(([left]) => left);
}

const JSON_PART = 30000;

function jsonParts(kind: string, value: unknown): (string | number)[][] {
  const json = JSON.stringify(value);
  const parts: (string | number)[][] = [];
  for (let index = 0; index * JSON_PART < json.length; index += 1) {
    parts.push([kind, index, json.slice(index * JSON_PART, (index + 1) * JSON_PART)]);
  }
  return parts.length ? parts : [[kind, 0, json]];
}

function waiversFromCell(value: string, index: number): Waiver[] {
  if (!value) return [];
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.flatMap((item, waiverIndex) => {
        const waiver = waiverFromJson(item, index, waiverIndex);
        return waiver ? [waiver] : [];
      });
    } catch {
      return [];
    }
  }
  return splitTriples(value).map(([requirementId, amount, reason], waiverIndex) => ({
    id: `waiver-${index}-${waiverIndex}`,
    requirementId,
    amount: Number(amount),
    reason,
    grantedAt: new Date().toISOString(),
  }));
}

function waiverFromJson(value: unknown, index: number, waiverIndex: number): Waiver | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Waiver>;
  if (typeof item.requirementId !== "string" || !item.requirementId) return null;
  return {
    id: typeof item.id === "string" && item.id ? item.id : `waiver-${index}-${waiverIndex}`,
    requirementId: item.requirementId,
    amount: typeof item.amount === "number" ? item.amount : Number(item.amount) || 0,
    reason: typeof item.reason === "string" ? item.reason : "",
    grantedAt: typeof item.grantedAt === "string" ? item.grantedAt : "",
  };
}

function staffingWaiverFromRow(row: Record<string, unknown>, index: number, errors: string[]): StaffingWaiver {
  const where = `StaffingWaivers row ${index + 2}`;
  return {
    id: required(row, "id", where, errors),
    blockId: required(row, "blockId", where, errors),
    rotationId: required(row, "rotationId", where, errors),
    minReduction: numberOr(cell(row, "minReduction"), 0),
    maxIncrease: numberOr(cell(row, "maxIncrease"), 0),
    reason: cell(row, "reason"),
    grantedAt: cell(row, "grantedAt"),
  };
}

function themeFromExport(value: unknown): ThemeChoice | null {
  if (typeof value === "string") {
    if (!value.trim()) return null;
    try {
      return themeChoice(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return themeChoice(value);
}

function themeChoice(value: unknown): ThemeChoice | null {
  if (!value || typeof value !== "object") return null;
  const choice = value as ThemeChoice;
  if (choice.id === "custom" && isCustomColors(choice.custom)) return { id: "custom", custom: choice.custom };
  if (typeof choice.id === "string" && SCHEMES.some((scheme) => scheme.id === choice.id)) return { id: choice.id };
  return null;
}

function isCustomColors(value: CustomColors | undefined): value is CustomColors {
  if (!value) return false;
  return (["sidebar", "steel", "paper", "card", "ink"] as const).every((key) => typeof value[key] === "string" && /^#[0-9a-fA-F]{6}$/.test(value[key]));
}

function nextDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function icsText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", " ").replaceAll(",", "\\,").replaceAll(";", "\\;");
}
