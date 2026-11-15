import { addDays } from "@/domain/calendar";
import type { Assignment, Block, Project, Requirement, RequirementApplicability, RequirementScope, Resident, Rotation, RotationCategory } from "@/domain/types";
import { buildEmptyProject } from "@/data/scenarios";

export interface Word {
  text: string;
  x: number;
  y: number;
  x2: number;
  page: number;
}

export interface LooseSpan {
  name: string;
  pgy: number;
  rotation: string;
  label: string;
  start: string | null;
  end: string | null;
  duties?: { date: string; name: string }[];
}

export interface PersonSeed {
  name: string;
  pgy: number;
}

export interface BuiltSchedule {
  project: Project | null;
  errors: string[];
  warnings: string[];
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13,
};

const PGY_SPAN = [1, 2, 3, 4, 5, 6, 7, 8];

export function academicYearFromName(fileName: string, now = new Date()): number {
  const range = fileName.match(/(20\d{2})\s*[-–]\s*(20\d{2})/);
  if (range) return Number(range[1]);
  const year = fileName.match(/20\d{2}/);
  if (year) return Number(year[0]);
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

export function titleFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return base || "Imported program";
}

export function looksLikeName(text: string): boolean {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length < 3 || value.length > 60) return false;
  if (/\b(pgy|block|ward|vacation|holiday|intern|rotation)\b/i.test(value)) return false;
  if (/^[A-Za-z][A-Za-z'’.-]+,\s*[A-Za-z]/.test(value)) return true;
  const parts = value.split(" ");
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every((part) => /^[A-Z]\.$/.test(part) || /^[A-Z][A-Za-z'’.-]{1,}$/.test(part));
}

export function categoryFor(name: string): RotationCategory {
  const value = name.toLowerCase();
  if (/vacat|holiday|\bleave\b/.test(value)) return "vacation";
  if (/night|float|cross\s*cover|swing/.test(value)) return "night";
  if (/\bicu\b|micu|msicu|sicu|nicu|picu|cicu|\bccu\b/.test(value)) return "icu";
  if (/ward|admitting|floor|inpatient|\bteam\b/.test(value)) return "ward";
  if (/ambulat|clinic/.test(value)) return "ambulatory";
  if (/emerg|\ber\b|\bed\b/.test(value)) return "emergency";
  if (/research/.test(value)) return "research";
  if (/elective/.test(value)) return "elective";
  return "other";
}

export function readRequirement(
  text: string,
  rotations: Array<{ id: string; name: string }>,
  residents: Array<{ id: string; name: string }> = [],
): Pick<Requirement, "name" | "description" | "scope" | "unit" | "amount" | "appliesTo" | "rotationIds"> & { note: string } {
  const source = text.replace(/\s+/g, " ").trim();
  const amountMatch = source.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen)\s*(block|week)s?\b/i)
    ?? source.match(/\b(?:need|needs|complete|required|minimum of|at least)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen)\b/i);
  const rawAmount = amountMatch?.[1]?.toLowerCase() ?? "";
  const amountSpecified = rawAmount !== "";
  const amount = amountSpecified ? (NUMBER_WORDS[rawAmount] ?? Number(rawAmount)) : 1;
  const unit = /week/i.test(amountMatch?.[0] ?? "") || (!/block/i.test(source) && /week/i.test(source)) ? "weeks" : "blocks";
  const pgys = [...new Set([...source.matchAll(/\bpgy\s*-?\s*(\d{1,2})\b/gi)].map((match) => Number(match[1])).filter((value) => value > 0))];
  const resident = residents
    .filter((person) => person.name.trim().length > 3 && source.toLowerCase().includes(person.name.trim().toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
  const rotationIds = matchRotations(source, rotations);
  const appliesTo: RequirementApplicability = resident
    ? { residentIds: [resident.id] }
    : pgys.length
      ? { pgy: pgys }
      : { all: true };
  const scope: RequirementScope = resident ? "individual" : pgys.length ? "pgy" : "program";
  const matched = rotations.filter((rotation) => rotationIds.includes(rotation.id)).map((rotation) => rotation.name);
  const who = resident ? resident.name : pgys.length ? `PGY-${pgys.join(", ")}` : "All residents";
  const name = (matched.length ? `${who} · ${matched.join(", ")}` : source).slice(0, 80);
  const note = rotationIds.length === 0
    ? "No rotation in this program matches the text. Choose the rotations it should count, or set the amount to 0 to keep the text only."
    : amountSpecified
      ? ""
      : "No number was found, so the amount is 1.";
  return { name, description: source, scope, unit, amount: Number.isFinite(amount) ? amount : 1, appliesTo, rotationIds, note };
}

export function gridToSpans(
  matrix: string[][],
  options: { academicStartYear: number; sheetName?: string },
): { spans: LooseSpan[]; people: PersonSeed[]; errors: string[]; warnings: string[] } {
  const where = options.sheetName ? `${options.sheetName}: ` : "";
  const oriented = orient(matrix.map((row) => row.map((cell) => cell.replace(/\s+/g, " ").trim())));
  const rows = oriented.rows.filter((row) => row.some((cell) => cell !== ""));
  if (!rows.length) return { spans: [], people: [], errors: [`${where}The sheet is empty.`], warnings: [] };
  let headerIndex = 0;
  let headerScore = -1;
  rows.slice(0, 15).forEach((row, index) => {
    const score = scoreHeader(row);
    if (score > headerScore) {
      headerScore = score;
      headerIndex = index;
    }
  });
  if (headerScore < 3) return { spans: [], people: [], errors: [`${where}No block, week, or date header was found.`], warnings: [] };
  const header = rows[headerIndex];
  let nameCol = 0;
  let nameScore = -1;
  header.forEach((_, column) => {
    const score = scoreNameColumn(rows, headerIndex, column);
    if (score > nameScore) {
      nameScore = score;
      nameCol = column;
    }
  });
  if (nameScore <= 0) return { spans: [], people: [], errors: [`${where}No resident names were found.`], warnings: [] };
  const pgyCol = header.findIndex((cell, index) => index !== nameCol && /^pgy(\s*level)?$/i.test(cell.trim()));
  const blockCols = header
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell, index }) => index !== nameCol && index !== pgyCol && cell.trim() !== "" && !/^(notes?|track|email)$/i.test(cell.trim()))
    .map(({ index }) => index);
  if (!blockCols.length) return { spans: [], people: [], errors: [`${where}No block columns were found.`], warnings: [] };
  const warnings: string[] = [];
  if (oriented.transposed) warnings.push(`${where}The grid was read with blocks down the side.`);
  const dateRow = rows[headerIndex + 1];
  const datedHeader = Boolean(dateRow && isDateRow(dateRow, blockCols));
  const data = rows.slice(headerIndex + (datedHeader ? 2 : 1));
  const cursor = { year: options.academicStartYear, previousMonth: 0 };
  const columnRanges = blockCols.map((column) => parseRange(`${header[column] ?? ""} ${datedHeader ? dateRow?.[column] ?? "" : ""}`, cursor));
  fillOpenEnds(columnRanges);
  const spans: LooseSpan[] = [];
  const people: PersonSeed[] = [];
  let pgy = 1;
  for (const row of data) {
    const nameCell = row[nameCol] ?? "";
    const section = pgyFrom(nameCell);
    const other = blockCols.some((column) => (row[column] ?? "") !== "");
    if (section && !other && nameCell.trim().length < 16) {
      pgy = section;
      continue;
    }
    if (!looksLikeName(nameCell)) continue;
    const rowPgy = pgyCol >= 0 ? pgyFrom(row[pgyCol] ?? "") ?? numberOr(row[pgyCol] ?? "") : pgy;
    people.push({ name: nameCell.trim(), pgy: rowPgy ?? pgy });
    blockCols.forEach((column, index) => {
      const rotation = (row[column] ?? "").trim();
      if (!rotation || normalize(rotation) === normalize(nameCell)) return;
      const range = columnRanges[index];
      spans.push({
        name: nameCell.trim(),
        pgy: rowPgy ?? pgy,
        rotation,
        label: header[column]?.trim() || `Block ${index + 1}`,
        start: range?.start ?? null,
        end: range?.end ?? null,
      });
    });
  }
  if (!people.length) return { spans: [], people: [], errors: [`${where}No resident names were found under the header.`], warnings };
  return { spans, people, errors: [], warnings };
}

const WEEKDAY = /^(?:sun|mon|tue(?:s)?|wed(?:nes)?|thu(?:r|rs)?|fri|sat)(?:day)?$/i;
const DAY_NUMBER = /^(?:[1-9]|[12]\d|3[01])$/;
const SHORT_MONTH = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface QgendaGrid {
  spans: LooseSpan[];
  people: PersonSeed[];
  errors: string[];
  warnings: string[];
  title: string | null;
}

export function qgendaGridToSpans(matrix: string[][]): QgendaGrid | null {
  const rows = matrix.map((row) => row.map((cell) => cell.replace(/\s+/g, " ").trim()));
  const weekdayIndex = rows.findIndex((row, index) => index < 25 && row.filter((cell) => WEEKDAY.test(cell)).length >= 7);
  if (weekdayIndex < 1) return null;
  const dayIndex = weekdayIndex - 1;
  const dayColumns = rows[dayIndex]
    .map((cell, index) => (DAY_NUMBER.test(cell) ? index : -1))
    .filter((index) => index >= 0);
  if (dayColumns.length < 7) return null;
  const nameColumn = staffColumn(rows, weekdayIndex, dayColumns[0] ?? 1);
  if (nameColumn < 0) return null;
  const dates = dayDates(rows, dayIndex, dayColumns);
  if (dates.filter(Boolean).length < 7) return null;
  const weeks = weekGroups(dates);
  const labels = uniqueLabels(weeks.map((week) => rangeLabel(week.start, week.end)), weeks.map((week) => week.start.slice(0, 4)));
  const warnings = ["Read as a QGenda staff grid. Shifts in the same week share one block."];
  const spans: LooseSpan[] = [];
  const people: PersonSeed[] = [];
  let mixed = 0;
  let stacked = 0;
  let index = weekdayIndex + 1;
  while (index < rows.length) {
    const label = rows[index]?.[nameColumn] ?? "";
    if (/^schedule notes\b/i.test(label) || /^\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(label)) break;
    if (!commaName(label)) {
      index += 1;
      continue;
    }
    const owned = [index];
    index += 1;
    while (index < rows.length && !(rows[index]?.[nameColumn] ?? "").trim()) {
      if (dayColumns.some((column) => taskText(rows[index]?.[column] ?? ""))) owned.push(index);
      index += 1;
    }
    const dayTasks = dayColumns.map((column) => taskList(owned.map((row) => rows[row]?.[column] ?? "")));
    const pgy = pgyFromTasks(dayTasks.flat());
    people.push({ name: label, pgy });
    weeks.forEach((week, weekIndex) => {
      const picked = majorityRotation(week.indexes.map((offset) => dayTasks[offset] ?? []));
      if (!picked.rotation) return;
      if (picked.mixed) mixed += 1;
      const duties = picked.duties.flatMap((duty) => {
        const date = dates[week.indexes[duty.index] ?? -1];
        return date ? [{ date, name: duty.name }] : [];
      });
      if (duties.length) stacked += 1;
      spans.push({
        name: label,
        pgy,
        rotation: picked.rotation,
        label: labels[weekIndex] ?? rangeLabel(week.start, week.end),
        start: week.start,
        end: week.end,
        ...(duties.length ? { duties } : {}),
      });
    });
  }
  if (!people.length) return { spans: [], people: [], errors: ["No staff names were found in the QGenda grid."], warnings, title: qgendaTitle(rows) };
  if (mixed) warnings.push(`${mixed} weeks include more than one shift. The shift covering the most days is kept.`);
  if (stacked) warnings.push(`${stacked} weeks include another shift on the same day. The block keeps the main rotation, and that shift stays on the day.`);
  warnings.push("QGenda does not include a training year. Intern shifts are PGY-1, resident shifts are PGY-2, and everyone else is PGY-1.");
  return { spans, people, errors: [], warnings, title: qgendaTitle(rows) };
}

function staffColumn(rows: string[][], weekdayIndex: number, firstDay: number): number {
  let best = Math.max(0, firstDay - 1);
  let score = -1;
  for (let column = 0; column <= firstDay; column += 1) {
    const count = rows.slice(weekdayIndex + 1, weekdayIndex + 50).filter((row) => commaName(row[column] ?? "")).length;
    if (count > score) {
      score = count;
      best = column;
    }
  }
  return score > 0 ? best : -1;
}

function dayDates(rows: string[][], dayIndex: number, columns: number[]): Array<string | null> {
  let carried: { month: number; year: number } | null = null;
  let previousDay = 0;
  return columns.map((column) => {
    const token = monthAbove(rows, dayIndex, column);
    const day = Number(rows[dayIndex]?.[column] ?? "");
    if (token) carried = token;
    else if (carried && previousDay && day < previousDay) {
      carried = carried.month === 12 ? { month: 1, year: carried.year + 1 } : { month: carried.month + 1, year: carried.year };
    }
    previousDay = day;
    if (!carried || day < 1) return null;
    return iso(carried.year, carried.month, day);
  });
}

function monthAbove(rows: string[][], dayIndex: number, column: number): { month: number; year: number } | null {
  for (let index = dayIndex - 1; index >= Math.max(0, dayIndex - 4); index -= 1) {
    const parsed = parseMonthToken(rows[index]?.[column] ?? "");
    if (parsed) return parsed;
  }
  return null;
}

function parseMonthToken(text: string): { month: number; year: number } | null {
  const named = text.trim().match(/^([A-Za-z]{3,9})[\s-]+(\d{2,4})$/);
  if (named) {
    const month = MONTH_INDEX[named[1].toLowerCase()];
    const raw = Number(named[2]);
    if (!month || !raw) return null;
    return { month, year: raw < 100 ? 2000 + raw : raw };
  }
  const numeric = text.trim().match(/^(\d{1,2})[/-](\d{4})$/);
  if (!numeric) return null;
  const month = Number(numeric[1]);
  if (month < 1 || month > 12) return null;
  return { month, year: Number(numeric[2]) };
}

function commaName(text: string): boolean {
  const value = text.trim();
  if (!/^[A-Za-z][A-Za-z'’.-]+,\s*[A-Za-z]/.test(value)) return false;
  return !/\b(pgy|block|ward|vacation|holiday|intern|rotation)\b/i.test(value);
}

function taskText(text: string): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value || /^(off|day off|x|—|-|n\/a)$/i.test(value)) return "";
  return value;
}

function taskList(values: string[]): string[] {
  const unique: string[] = [];
  for (const value of values) {
    const text = taskText(value);
    if (!text || unique.some((item) => item.toLowerCase() === text.toLowerCase())) continue;
    unique.push(text);
  }
  return unique;
}

function mondayOf(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return date.toISOString().slice(0, 10);
}

function weekGroups(dates: Array<string | null>): Array<{ start: string; end: string; indexes: number[] }> {
  const weeks: Array<{ start: string; end: string; indexes: number[] }> = [];
  dates.forEach((date, index) => {
    if (!date) return;
    const last = weeks.at(-1);
    if (last && mondayOf(last.start) === mondayOf(date)) {
      last.end = date;
      last.indexes.push(index);
      return;
    }
    weeks.push({ start: date, end: date, indexes: [index] });
  });
  return weeks;
}

function rangeLabel(start: string, end: string): string {
  if (start === end) return dayLabel(start);
  const left = dayLabel(start);
  const right = dayLabel(end);
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${left} ${start.slice(0, 4)} – ${right} ${end.slice(0, 4)}`;
  return `${left} – ${right}`;
}

function uniqueLabels(labels: string[], years: string[]): string[] {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return labels.map((label, index) => ((counts.get(label) ?? 0) > 1 ? `${label} ${years[index] ?? ""}`.trim() : label));
}

function majorityRotation(days: string[][]): { rotation: string; mixed: boolean; duties: Array<{ index: number; name: string }> } {
  const counts = new Map<string, number>();
  const order: string[] = [];
  const leading = new Set<string>();
  const normalized = days.map((tasks) => {
    const unique: string[] = [];
    for (const task of tasks) {
      if (unique.some((item) => item.toLowerCase() === task.toLowerCase())) continue;
      unique.push(task);
    }
    return unique;
  });
  normalized.forEach((tasks) => {
    tasks.forEach((task, index) => {
      if (!counts.has(task)) order.push(task);
      counts.set(task, (counts.get(task) ?? 0) + 1);
      if (index === 0) leading.add(task);
    });
  });
  const max = Math.max(0, ...counts.values());
  if (!max) return { rotation: "", mixed: false, duties: [] };
  const leaders = order.filter((task) => counts.get(task) === max);
  const preferred = leaders.filter((task) => leading.has(task));
  const blockNames = new Set(preferred.length ? preferred : leaders);
  const duties: Array<{ index: number; name: string }> = [];
  let mixed = false;
  normalized.forEach((tasks, index) => {
    const hasBlock = tasks.some((task) => blockNames.has(task));
    for (const task of tasks) {
      if (blockNames.has(task)) continue;
      if (hasBlock) duties.push({ index, name: task });
      else mixed = true;
    }
  });
  return { rotation: [...blockNames].join(" / "), mixed, duties };
}

function pgyFromTasks(tasks: string[]): number {
  const intern = tasks.filter((task) => /\bintern\b/i.test(task)).length;
  const resident = tasks.filter((task) => /\bresident\b/i.test(task)).length;
  if (intern > 0 && intern >= resident) return 1;
  if (resident > 0) return 2;
  return 1;
}

function dayLabel(start: string): string {
  const [, month, day] = start.split("-").map(Number);
  return `${SHORT_MONTH[month] ?? ""} ${day}`.trim();
}

function qgendaTitle(rows: string[][]): string | null {
  for (const row of rows.slice(0, 4)) {
    const cell = row.map((item) => item.trim()).find(Boolean);
    if (!cell || /^printed\b/i.test(cell) || parseMonthToken(cell)) continue;
    if (cell.length > 2 && cell.length < 120) return cell;
  }
  return null;
}

export function wordsToSpans(words: Word[], academicStartYear: number): { spans: LooseSpan[]; people: PersonSeed[]; warnings: string[] } {
  const warnings: string[] = [];
  const spans: LooseSpan[] = [];
  const people: PersonSeed[] = [];
  const pages = new Map<number, Word[]>();
  for (const word of words) {
    const list = pages.get(word.page) ?? [];
    list.push(word);
    pages.set(word.page, list);
  }
  let tables = 0;
  for (const pageWords of pages.values()) {
    const lines = clusterLines(pageWords);
    const headers = tableHeaders(lines);
    if (!headers.length) {
      warnings.push("A page had no block columns and was skipped.");
      continue;
    }
    headers.forEach((headerIndex, tableIndex) => {
      const next = headers[tableIndex + 1] ?? lines.length;
      const columns = columnsFrom(lines[headerIndex]);
      if (columns.length < 2) return;
      tables += 1;
      const body = lines.slice(headerIndex + 1, next);
      const side = nameSide(body, columns);
      const gutterText = (line: Word[]) => joinWords(line.filter((word) => inGutter(word, columns, side)));
      let pgy = pgyFrom(gutterText(lines[headerIndex])) ?? 1;
      const firstResident = body.findIndex((line) => looksLikeName(gutterText(line)));
      const dateLines = firstResident === -1 ? body : body.slice(0, firstResident);
      const residentLines = firstResident === -1 ? [] : body.slice(firstResident);
      for (const line of dateLines) {
        const found = pgyFrom(gutterText(line));
        if (found) pgy = found;
      }
      const dateText = columns.map(() => "");
      for (const line of dateLines) {
        for (const word of line) {
          const index = columnIndex(word, columns);
          if (index >= 0) dateText[index] += ` ${word.text}`;
        }
      }
      const cursor = { year: academicStartYear, previousMonth: 0 };
      const ranges = dateText.map((text) => parseRange(text, cursor));
      fillOpenEnds(ranges);
      for (const line of residentLines) {
        const name = gutterText(line).replace(/\s+/g, " ").trim();
        if (!looksLikeName(name)) continue;
        const found = pgyFrom(name);
        const rowPgy = found ?? pgy;
        people.push({ name, pgy: rowPgy });
        const cells = columns.map(() => [] as string[]);
        for (const word of line) {
          const index = columnIndex(word, columns);
          if (index >= 0) cells[index].push(word.text);
        }
        cells.forEach((tokens, index) => {
          const rotation = tokens.join(" ").replace(/\s+/g, " ").trim();
          if (!rotation || normalize(rotation) === normalize(name)) return;
          spans.push({
            name,
            pgy: rowPgy,
            rotation,
            label: columns[index].label,
            start: ranges[index]?.start ?? null,
            end: ranges[index]?.end ?? null,
          });
        });
      }
    });
  }
  if (!tables) warnings.push("No block schedule table was found in the PDF.");
  return { spans, people, warnings };
}

export function projectFromSpans(
  spans: LooseSpan[],
  options: { name: string; people?: PersonSeed[]; warnings?: string[]; asOfDate?: string },
): BuiltSchedule {
  const warnings = [...(options.warnings ?? [])];
  const people = dedupePeople([...(options.people ?? []), ...spans.map((span) => ({ name: span.name, pgy: span.pgy }))]);
  if (!people.length) return { project: null, errors: ["No residents were found in the file."], warnings };
  const dated = spans.filter((span) => span.start && span.end && span.rotation.trim());
  const undated = spans.filter((span) => span.rotation.trim() && (!span.start || !span.end));
  if (dated.length && undated.length) warnings.push(`${undated.length} cells had a rotation but no dates, so they were skipped.`);
  const blocks = dated.length ? blocksFromSpans(dated, warnings) : blocksFromLabels(spans, academicYearFromName(options.name));
  if (!blocks.length) return { project: null, errors: ["No schedule blocks were found."], warnings };
  const usedRotations = new Set<string>();
  const usedResidents = new Set<string>();
  const rotationByName = new Map<string, Rotation>();
  const rotations: Rotation[] = [];
  const ensureRotation = (name: string): Rotation => {
    const key = normalize(name);
    const existing = rotationByName.get(key);
    if (existing) return existing;
    const category = categoryFor(name);
    const rotation: Rotation = {
      id: uniqueSlug(name, usedRotations, "rotation"),
      name,
      category,
      durationBlocks: 1,
      eligiblePgy: [...PGY_SPAN],
      eligibleTracks: [],
      staffing: [],
      requirementCredits: [],
      careerRelevance: [],
      workloadIntensity: category === "icu" ? 5 : category === "night" ? 4 : category === "ward" || category === "emergency" ? 3 : category === "vacation" || category === "research" ? 1 : 2,
      maxConsecutive: null,
      maxBlocksPerResident: null,
      noConsecutiveCategories: [],
      prerequisites: [],
      availableBlocks: [],
      relaxStaffingMin: 0,
      relaxStaffingMax: 0,
      staffingPriority: 1,
      color: "",
    };
    rotationByName.set(key, rotation);
    rotations.push(rotation);
    return rotation;
  };
  const residents: Resident[] = people.map((person) => {
    const startYear = Number(blocks[0].startDate.slice(0, 4)) - (person.pgy - 1);
    const length = Math.max(person.pgy, 3);
    return {
      id: uniqueSlug(person.name, usedResidents, "resident"),
      name: person.name,
      pgy: person.pgy,
      track: "Categorical",
      startDate: `${startYear}-07-01`,
      graduationDate: `${startYear + length}-06-30`,
      previousRotations: [],
      careerInterests: [],
      electivePreferences: [],
      restrictions: [],
      historicalBurden: { icu: 0, nights: 0, wards: 0, holiday: 0 },
      lockedAssignments: [],
      waivers: [],
      notes: "",
    };
  });
  const residentByName = new Map(residents.map((resident) => [normalize(resident.name), resident]));
  const assignments: Assignment[] = [];
  const seen = new Set<string>();
  const source = assignLabeled(spans, blocks);
  for (const item of source) {
    const resident = residentByName.get(normalize(item.name));
    if (!resident || !item.rotation.trim()) continue;
    const key = `${resident.id}|${item.blockId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rotation = ensureRotation(item.rotation.trim());
    const duties = item.duties.filter((duty) => duty.date && duty.name.trim());
    assignments.push({
      residentId: resident.id,
      blockId: item.blockId,
      rotationId: rotation.id,
      locked: false,
      source: "import",
      ...(duties.length ? { duties } : {}),
    });
  }
  const rotationById = new Map(rotations.map((rotation) => [rotation.id, rotation]));
  const vacationCounts = blocks.map((block) => assignments.filter((item) => item.blockId === block.id && rotationById.get(item.rotationId)?.category === "vacation").length);
  const shell = buildEmptyProject();
  const today = options.asOfDate ?? todayIso();
  const project: Project = {
    ...shell,
    id: uniqueSlug(options.name, new Set(), "program"),
    name: options.name,
    academicYear: academicLabel(blocks),
    asOfDate: blocks.some((block) => block.startDate <= today && today <= block.endDate) ? today : blocks[0].startDate,
    blockWeeks: medianWeeks(blocks),
    blocks,
    interests: [],
    residents,
    rotations,
    requirements: [],
    vacations: [],
    assignments,
    vacationRules: { defaultCapacity: Math.max(0, ...vacationCounts), capacityByBlock: [], blackoutBlockIds: [] },
    staffingWaivers: [],
    scenarioNote: "",
    syntheticDemo: false,
  };
  warnings.unshift(`Imported ${residents.length} residents, ${blocks.length} blocks, ${rotations.length} rotations, and ${assignments.length} assignments.`);
  return { project, errors: [], warnings };
}

function matchRotations(text: string, rotations: Array<{ id: string; name: string }>): string[] {
  const haystack = text.toLowerCase();
  const ids = new Set<string>();
  for (const rotation of rotations) {
    const name = rotation.name.toLowerCase().trim();
    if (name.length >= 3 && haystack.includes(name)) ids.add(rotation.id);
  }
  const aliases: Array<[RegExp, RegExp]> = [
    [/\b(micu|msicu|medical icu)\b/i, /\b(micu|msicu|medical icu)\b/i],
    [/\b(sicu|surgical icu)\b/i, /\b(sicu|surgical icu)\b/i],
    [/\b(cicu|cardiac icu|ccu)\b/i, /\b(cicu|cardiac|ccu)\b/i],
    [/\bnicu\b/i, /\bnicu\b/i],
    [/\bpicu\b/i, /\bpicu\b/i],
    [/\bicu\b/i, /\bicu\b/i],
    [/\b(night\s*float|nights?|\bnf\b)\b/i, /\b(night|float|\bnf\b)/i],
    [/\bwards?\b/i, /\bwards?\b/i],
    [/\b(vacation|leave)\b/i, /\b(vacation|leave)\b/i],
    [/\b(ambulatory|clinic)\b/i, /\b(ambulat|clinic)\b/i],
    [/\b(emergency|\ber\b|\bed\b)\b/i, /\b(emerg|\ber\b|\bed\b)/i],
    [/\belectives?\b/i, /\belective\b/i],
    [/\bresearch\b/i, /\bresearch\b/i],
  ];
  for (const [inText, inName] of aliases) {
    if (!inText.test(text)) continue;
    for (const rotation of rotations) {
      if (inName.test(rotation.name)) ids.add(rotation.id);
    }
  }
  return rotations.map((rotation) => rotation.id).filter((id) => ids.has(id));
}

function blocksFromSpans(spans: LooseSpan[], warnings: string[]): Block[] {
  const labels: string[] = [];
  const chosen = new Map<string, { start: string; end: string }>();
  const disagreed = new Set<string>();
  for (const span of spans) {
    if (!span.label || !span.start || !span.end) continue;
    if (!labels.includes(span.label)) labels.push(span.label);
    const current = chosen.get(span.label);
    if (!current) chosen.set(span.label, { start: span.start, end: span.end });
    else if (current.start !== span.start || current.end !== span.end) disagreed.add(span.label);
  }
  if (disagreed.size) warnings.push("Some classes list different dates for the same block. The dates printed on the first schedule are used.");
  const built = labels.map((label, index) => {
    const range = chosen.get(label);
    return {
      id: blockId(index),
      index,
      label,
      startDate: range?.start ?? "",
      endDate: range?.end ?? "",
      holiday: /holiday/i.test(label),
    };
  }).filter((block) => block.startDate && block.endDate);
  built.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.label.localeCompare(b.label));
  return built.map((block, index) => ({ ...block, index, id: blockId(index) }));
}

function blocksFromLabels(spans: LooseSpan[], year: number): Block[] {
  const labels: string[] = [];
  for (const span of spans) {
    if (span.label && !labels.includes(span.label)) labels.push(span.label);
  }
  let cursor = `${year}-07-01`;
  return labels.map((label, index) => {
    const endDate = addDays(cursor, 13);
    const block: Block = { id: blockId(index), index, label, startDate: cursor, endDate, holiday: /holiday/i.test(label) };
    cursor = addDays(endDate, 1);
    return block;
  });
}

function assignLabeled(spans: LooseSpan[], blocks: Block[]): Array<{ name: string; blockId: string; rotation: string; duties: { date: string; name: string }[] }> {
  const byLabel = new Map(blocks.map((block) => [block.label, block.id]));
  return spans
    .map((span) => ({ name: span.name, blockId: byLabel.get(span.label) ?? "", rotation: span.rotation, duties: span.duties ?? [] }))
    .filter((item) => item.blockId);
}

function tableHeaders(lines: Word[][]): number[] {
  const blocks = lines.flatMap((line, index) => (isBlockHeader(line) ? [index] : []));
  if (blocks.length) return blocks;
  const dates: number[] = [];
  lines.forEach((line, index) => {
    if (!isDateHeader(line)) return;
    if (dates.length && index - dates[dates.length - 1] <= 3) return;
    dates.push(index);
  });
  return dates;
}

interface Column {
  label: string;
  left: number;
  right: number;
}

function columnsFrom(line: Word[]): Column[] {
  const groups = clusterTokens(line, 12);
  const raw: Array<{ label: string; x: number; x2: number }> = [];
  for (const group of groups) {
    const label = cleanLabel(group.map((word) => word.text).join(" "));
    if (!label) continue;
    raw.push({ label, x: group[0].x, x2: group[group.length - 1].x2 });
  }
  if (raw.length < 2) return [];
  const gaps = raw.slice(1).map((column, index) => column.x - raw[index].x2);
  const gap = median(gaps.filter((value) => value > 0)) || 22;
  return raw.map((column, index) => ({
    label: column.label,
    left: index === 0 ? column.x - 8 : (raw[index - 1].x + column.x) / 2,
    right: index === raw.length - 1 ? column.x2 + gap : (column.x2 + raw[index + 1].x) / 2,
  }));
}

function cleanLabel(text: string): string | null {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value || /^pgy/i.test(value)) return null;
  const half = value.match(/(\d{1,2})\s*([A-Za-z])$/);
  if (half && (/block/i.test(value) || value.length <= 4)) return `${half[1]}${half[2].toUpperCase()}`;
  if (/holiday/i.test(value)) return value.replace(/holiday/i, "Holiday");
  if (/^block\s+\d+/i.test(value)) return value;
  if (looksLikeDate(value) && !/block/i.test(value)) return value;
  return null;
}

function isBlockHeader(line: Word[]): boolean {
  const labels = columnsFrom(line).map((column) => column.label);
  const blocks = labels.filter((label) => /^\d{1,2}[A-Z]$/.test(label) || /holiday/i.test(label) || /^block\s+\d+/i.test(label));
  return blocks.length >= 4;
}

function isDateHeader(line: Word[]): boolean {
  const labels = columnsFrom(line).map((column) => column.label);
  return labels.filter((label) => looksLikeDate(label)).length >= 4;
}

function nameSide(lines: Word[][], columns: Column[]): "left" | "right" {
  let left = 0;
  let right = 0;
  for (const line of lines) {
    if (looksLikeName(joinWords(line.filter((word) => wordCenter(word) < columns[0].left)))) left += 1;
    if (looksLikeName(joinWords(line.filter((word) => wordCenter(word) > columns[columns.length - 1].right)))) right += 1;
  }
  return right > left ? "right" : "left";
}

function inGutter(word: Word, columns: Column[], side: "left" | "right"): boolean {
  const center = wordCenter(word);
  return side === "left" ? center < columns[0].left : center > columns[columns.length - 1].right;
}

function columnIndex(word: Word, columns: Column[]): number {
  const center = wordCenter(word);
  return columns.findIndex((column) => center >= column.left && center < column.right);
}

function clusterLines(words: Word[]): Word[][] {
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Word[][] = [];
  for (const word of sorted) {
    const line = lines.at(-1);
    const anchor = line ? Math.min(...line.map((item) => item.y)) : 0;
    if (!line || word.y - anchor > 2.2) lines.push([word]);
    else line.push(word);
  }
  return lines;
}

function clusterTokens(line: Word[], gap: number): Word[][] {
  const tokens = [...line].sort((a, b) => a.x - b.x);
  const groups: Word[][] = [];
  for (const token of tokens) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (!group || !previous || token.x - previous.x2 > gap) groups.push([token]);
    else group.push(token);
  }
  return groups;
}

function joinWords(words: Word[]): string {
  return [...words].sort((a, b) => a.x - b.x).map((word) => word.text).join(" ").replace(/\s+/g, " ").trim();
}

function wordCenter(word: Word): number {
  return (word.x + word.x2) / 2;
}

function scoreHeader(cells: string[]): number {
  let score = 0;
  for (const cell of cells) {
    if (/\bblock\s*\d/i.test(cell) || /^week\s*\d/i.test(cell)) score += 3;
    if (/^\d{1,2}[a-z]$/i.test(cell.trim())) score += 3;
    if (/\bholiday\b/i.test(cell)) score += 2;
    if (looksLikeDate(cell)) score += 2;
  }
  return score;
}

function scoreNameColumn(rows: string[][], headerIndex: number, column: number): number {
  const header = rows[headerIndex]?.[column] ?? "";
  let score = /^(name|resident|trainee|physician|fellow)$/i.test(header.trim()) ? 5 : 0;
  for (const row of rows.slice(headerIndex + 1, headerIndex + 40)) {
    if (looksLikeName(row[column] ?? "")) score += 2;
  }
  return score;
}

function orient(matrix: string[][]): { rows: string[][]; transposed: boolean } {
  const rowScore = Math.max(0, ...matrix.slice(0, 12).map(scoreHeader));
  const width = Math.max(0, ...matrix.map((row) => row.length));
  let colScore = 0;
  for (let column = 0; column < Math.min(width, 6); column += 1) {
    colScore = Math.max(colScore, scoreHeader(matrix.slice(0, 25).map((row) => row[column] ?? "")));
  }
  if (colScore > rowScore + 1) return { rows: transpose(matrix), transposed: true };
  return { rows: matrix, transposed: false };
}

function transpose(matrix: string[][]): string[][] {
  const width = Math.max(0, ...matrix.map((row) => row.length));
  return Array.from({ length: width }, (_, column) => matrix.map((row) => row[column] ?? ""));
}

function isDateRow(row: string[], columns: number[]): boolean {
  const dated = columns.filter((column) => looksLikeDate(row[column] ?? "")).length;
  return dated >= Math.max(2, Math.ceil(columns.length / 3));
}

export function looksLikeDate(text: string): boolean {
  return /\b(20\d{2}-\d{2}-\d{2})\b/.test(text)
    || /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(text)
    || /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}\b/i.test(text);
}

function parseRange(text: string, cursor: { year: number; previousMonth: number }): { start: string | null; end: string | null } {
  const points: string[] = [];
  const pattern = /\b(?:(20\d{2})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{2,4})|(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?)\b/gi;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) {
      cursor.year = Number(match[1]);
      cursor.previousMonth = Number(match[2]);
      points.push(iso(cursor.year, cursor.previousMonth, Number(match[3])));
      continue;
    }
    if (match[4]) {
      cursor.year = match[6].length === 2 ? Number(`20${match[6]}`) : Number(match[6]);
      cursor.previousMonth = Number(match[4]);
      points.push(iso(cursor.year, cursor.previousMonth, Number(match[5])));
      continue;
    }
    const month = MONTH_INDEX[match[7].toLowerCase()];
    const day = Number(match[8]);
    if (!month || !day) continue;
    if (cursor.previousMonth && month < cursor.previousMonth) cursor.year += 1;
    cursor.previousMonth = month;
    points.push(iso(cursor.year, month, day));
  }
  if (!points.length) return { start: null, end: null };
  if (points.length === 1) return { start: points[0], end: null };
  const start = points[0];
  const end = points[points.length - 1];
  return start <= end ? { start, end } : { start: end, end: start };
}

function fillOpenEnds(ranges: Array<{ start: string | null; end: string | null } | undefined>): void {
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    if (!range?.start || range.end) continue;
    const next = ranges.slice(index + 1).find((item) => item?.start)?.start;
    range.end = next ? addDays(next, -1) : addDays(range.start, 13);
    if (range.end < range.start) range.end = range.start;
  }
}

function pgyFrom(text: string): number | null {
  const match = text.match(/pgy\s*-?\s*(\d{1,2})/i);
  if (!match) return null;
  const value = Number(match[1]);
  return value > 0 ? value : null;
}

function numberOr(text: string): number | null {
  const value = Number(text.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

function dedupePeople(people: PersonSeed[]): PersonSeed[] {
  const seen = new Map<string, PersonSeed>();
  for (const person of people) {
    const key = normalize(person.name);
    if (!key || seen.has(key)) continue;
    seen.set(key, { name: person.name.replace(/\s+/g, " ").trim(), pgy: person.pgy > 0 ? person.pgy : 1 });
  }
  return [...seen.values()];
}

function uniqueSlug(value: string, used: Set<string>, prefix: string): string {
  const base = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || prefix;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function blockId(index: number): string {
  return `b${String(index + 1).padStart(2, "0")}`;
}

function academicLabel(blocks: Block[]): string {
  const start = Number(blocks[0]?.startDate.slice(0, 4));
  const end = Number(blocks[blocks.length - 1]?.endDate.slice(0, 4));
  if (!start) return "";
  return start === end ? String(start) : `${start}-${end}`;
}

function medianWeeks(blocks: Block[]): number {
  const lengths = blocks.map((block) => Math.round((Date.parse(block.endDate) - Date.parse(block.startDate)) / 86400000) + 1).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] ?? 28;
  return Math.max(1, Math.round(median / 7));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function todayIso(): string {
  const now = new Date();
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
