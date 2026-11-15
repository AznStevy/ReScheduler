import type { Block } from "./types";

export function academicStartYear(isoDate: string): number {
  const [year, month] = isoDate.split("-").map(Number);
  if (!year || !month) return 0;
  return month >= 7 ? year : year - 1;
}

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function makeBlocks(count: number, start = "2026-07-01"): Block[] {
  const blocks: Block[] = [];
  let cursor = start;
  for (let index = 0; index < count; index += 1) {
    const endDate = addDays(cursor, 27);
    blocks.push({
      id: `b${String(index + 1).padStart(2, "0")}`,
      index,
      label: `Block ${index + 1}`,
      startDate: cursor,
      endDate,
      holiday: false,
    });
    cursor = addDays(endDate, 1);
  }
  return blocks;
}

export function isPastBlock(block: Block, asOfDate: string): boolean {
  return block.endDate < asOfDate;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function blockRangeLabel(start: string, end: string): string {
  const left = shortDay(start);
  const right = shortDay(end);
  if (!left || !right) return "";
  if (start === end) return left;
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${left} ${start.slice(0, 4)} – ${right} ${end.slice(0, 4)}`;
  return `${left} – ${right}`;
}

/** Move one edge of a block. The shared edge of the neighboring block moves with it, and each block keeps at least one day. */
export function editBlockDate(blocks: Block[], blockId: string, edge: "startDate" | "endDate", value: string): Block[] {
  if (!ISO_DATE.test(value)) return blocks;
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return blocks;
  const next = blocks.map((block) => ({ ...block }));
  const previous = next.map((block) => ({ startDate: block.startDate, endDate: block.endDate, label: block.label }));
  const block = next[index];
  if (edge === "startDate") {
    block.startDate = value;
    if (block.startDate > block.endDate) block.endDate = block.startDate;
  } else {
    block.endDate = value;
    if (block.endDate < block.startDate) block.startDate = block.endDate;
  }
  if (block.startDate !== previous[index].startDate) pullPrevious(next, index);
  if (block.endDate !== previous[index].endDate) pushNext(next, index);
  const labeled = next.map((item, itemIndex) => {
    const old = previous[itemIndex];
    if (item.startDate === old.startDate && item.endDate === old.endDate) return item;
    if (!isGeneratedLabel(old.label, old.startDate, old.endDate)) return item;
    return { ...item, label: blockRangeLabel(item.startDate, item.endDate) };
  });
  return disambiguateLabels(labeled);
}

function shortDay(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  if (!month || !day) return "";
  return `${MONTHS[month - 1] ?? ""} ${day}`.trim();
}

function isGeneratedLabel(label: string, start: string, end: string): boolean {
  const base = blockRangeLabel(start, end);
  return Boolean(base) && (label === base || label === `${base} ${start.slice(0, 4)}`);
}

function pullPrevious(blocks: Block[], index: number) {
  if (index <= 0) return;
  const previous = blocks[index - 1];
  previous.endDate = addDays(blocks[index].startDate, -1);
  if (previous.startDate <= previous.endDate) return;
  previous.startDate = previous.endDate;
  pullPrevious(blocks, index - 1);
}

function pushNext(blocks: Block[], index: number) {
  if (index >= blocks.length - 1) return;
  const following = blocks[index + 1];
  following.startDate = addDays(blocks[index].endDate, 1);
  if (following.startDate <= following.endDate) return;
  following.endDate = following.startDate;
  pushNext(blocks, index + 1);
}

function disambiguateLabels(blocks: Block[]): Block[] {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    const base = blockRangeLabel(block.startDate, block.endDate);
    if (block.label === base) counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return blocks.map((block) => {
    const base = blockRangeLabel(block.startDate, block.endDate);
    if (block.label === base && (counts.get(base) ?? 0) > 1) return { ...block, label: `${base} ${block.startDate.slice(0, 4)}` };
    return block;
  });
}
