import { staffingLimits, vacationCapacity } from "@/domain/lookups";
import type { Block, Project, RotationCategory } from "@/domain/types";
import { categoryBackground } from "@/ui/abbrev";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { useRef, useState } from "react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const WASH = ["#E4EDF2", "#F4E8E2", "#E3EFE7", "#F6EDDC", "#E7E9EE", "#E5EEF3", "#F3EFE2", "#E6E9F0", "#F3E4E4", "#E8F0EA", "#F7EEE8", "#E8EEF4", "#EEF1E8"];

export function blockWash(index: number): string {
  return WASH[index % WASH.length];
}

function parts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

export function formatDay(iso: string): string {
  const { month, day } = parts(iso);
  return `${MONTHS[month - 1].slice(0, 3)} ${day}`;
}

export function blockOn(blocks: Block[], iso: string): Block | undefined {
  return blocks.find((block) => block.startDate <= iso && iso <= block.endDate);
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function weeksOf(year: number, month: number): Array<Array<string | null>> {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const pad = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: pad }, () => null);
  for (let day = 1; day <= count; day += 1) cells.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<string | null>> = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

function monthsBetween(blocks: Block[]): Array<{ year: number; month: number }> {
  if (!blocks.length) return [];
  const start = parts(blocks[0].startDate);
  const end = parts(blocks[blocks.length - 1].endDate);
  const months: Array<{ year: number; month: number }> = [];
  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export function blockSnapshot(project: Project, blockId: string) {
  const gaps = project.rotations.reduce((sum, rotation) => {
    const limits = staffingLimits(project, rotation, blockId);
    const assigned = project.assignments.filter((item) => item.blockId === blockId && item.rotationId === rotation.id).length;
    return sum + Math.max(0, limits.min - assigned);
  }, 0);
  return { gaps, capacity: vacationCapacity(project, blockId) };
}

export function BlockCalendar({
  project,
  selectedId,
  onSelect,
  variant = "full",
}: {
  project: Project;
  selectedId: string | null;
  onSelect: (blockId: string) => void;
  variant?: "full" | "strip";
}) {
  const { blocks, asOfDate } = project;
  const current = blockOn(blocks, asOfDate);
  const [hover, setHover] = useState<{ blockId: string; day: string; x: number; y: number } | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const armHover = (blockId: string, day: string, event: { clientX: number; clientY: number }) => {
    cancelClose();
    if (openTimer.current) window.clearTimeout(openTimer.current);
    const point = { x: event.clientX, y: event.clientY };
    openTimer.current = window.setTimeout(() => setHover({ blockId, day, ...point }), 700);
  };
  const scheduleClose = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = null;
    cancelClose();
    closeTimer.current = window.setTimeout(() => setHover(null), 280);
  };
  return (
    <div className="grid gap-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {blocks.map((block) => {
          const summary = blockSnapshot(project, block.id);
          const active = block.id === selectedId;
          const now = block.id === current?.id;
          return (
            <button
              key={block.id}
              type="button"
              onClick={() => onSelect(block.id)}
              className={`min-w-[132px] shrink-0 border px-3 py-2 text-left ${active ? "border-navy bg-navy text-white" : "on-tint border-line hover:border-steel"}`}
              style={active ? undefined : { background: blockWash(block.index) }}
            >
              <div className="flex items-center justify-between gap-2 font-mono text-[12px]">
                <span>{block.id.toUpperCase()}</span>
                {block.locked ? <Lock className="h-3 w-3" aria-hidden="true" /> : now ? <span className={active ? "on-navy-soft" : "on-tint-soft"}>Current</span> : null}
              </div>
              <div className="mt-1 text-[13px]">{formatDay(block.startDate)} – {formatDay(block.endDate)}</div>
              <div className={`mt-1 text-[12px] ${active ? "on-navy-soft" : "on-tint-soft"}`}>
                {block.locked ? "Locked" : block.holiday ? "Holiday" : summary.capacity === 0 ? "Blackout" : summary.gaps ? `${summary.gaps} coverage gaps` : project.assignments.length ? "Covered" : "Open"}
              </div>
            </button>
          );
        })}
      </div>
      {variant === "strip" ? null : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {monthsBetween(blocks).map(({ year, month }) => (
            <MonthCard
              key={monthKey(year, month)}
              year={year}
              month={month}
              blocks={blocks}
              asOfDate={asOfDate}
              selectedId={selectedId}
              onSelect={onSelect}
              onHover={armHover}
              onLeave={scheduleClose}
            />
          ))}
        </div>
      )}
      {hover ? (
        <DayRoster
          project={project}
          blockId={hover.blockId}
          day={hover.day}
          x={hover.x}
          y={hover.y}
          onEnter={cancelClose}
          onLeave={scheduleClose}
        />
      ) : null}
    </div>
  );
}

function MonthCard({
  year,
  month,
  blocks,
  asOfDate,
  selectedId,
  onSelect,
  onHover,
  onLeave,
}: {
  year: number;
  month: number;
  blocks: Block[];
  asOfDate: string;
  selectedId: string | null;
  onSelect: (blockId: string) => void;
  onHover: (blockId: string, day: string, event: { clientX: number; clientY: number }) => void;
  onLeave: () => void;
}) {
  const weeks = weeksOf(year, month);
  return (
    <section className="border border-line bg-card px-3 py-3">
      <h3 className="mb-2 text-[14px] font-semibold text-navy">{MONTHS[month - 1]} {year}</h3>
      <div className="grid grid-cols-7 gap-1 text-center font-mono text-[11px] text-muted">
        {WEEKDAYS.map((day) => <div key={day}>{day}</div>)}
      </div>
      <div className="mt-1 grid gap-1">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="grid grid-cols-7 gap-1">
            {week.map((iso, dayIndex) => {
              if (!iso) return <div key={`${weekIndex}-${dayIndex}`} className="h-9" />;
              const block = blockOn(blocks, iso);
              const day = parts(iso).day;
              const starts = block?.startDate === iso || day === 1;
              const selected = block?.id === selectedId;
              const today = iso === asOfDate;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={!block}
                  onClick={() => block && onSelect(block.id)}
                  onMouseEnter={(event) => block && onHover(block.id, iso, event)}
                  onMouseLeave={onLeave}
                  className={`flex h-9 flex-col items-center justify-center border text-[12px] leading-none ${selected ? "border-navy" : "border-transparent"} ${today ? "ring-2 ring-steel" : ""}`}
                  style={{ background: block ? blockWash(block.index) : "transparent" }}
                >
                  <span className={`font-mono text-[10px] ${block ? "on-tint-soft" : "text-steel"}`}>{starts && block ? block.id.toUpperCase() : ""}</span>
                  <span className={block ? "on-tint" : "text-ink"}>{day}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

const CATEGORY_ORDER: RotationCategory[] = ["ward", "icu", "night", "ambulatory", "emergency", "elective", "research", "vacation", "other"];
const CATEGORY_LABEL: Record<RotationCategory, string> = {
  ward: "Wards",
  icu: "ICU",
  night: "Nights",
  ambulatory: "Ambulatory",
  emergency: "Emergency",
  elective: "Elective",
  research: "Research",
  vacation: "Vacation",
  other: "Other",
};

function DayRoster({
  project,
  blockId,
  day,
  x,
  y,
  onEnter,
  onLeave,
}: {
  project: Project;
  blockId: string;
  day: string;
  x: number;
  y: number;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const block = project.blocks.find((item) => item.id === blockId);
  const [openCategory, setOpenCategory] = useState<RotationCategory | null>(null);
  const [openRotation, setOpenRotation] = useState<string | null>(null);
  const groups = new Map<string, { category: RotationCategory; names: string[] }>();
  for (const assignment of project.assignments) {
    if (assignment.blockId !== blockId) continue;
    const rotation = project.rotations.find((item) => item.id === assignment.rotationId);
    const label = rotation?.name ?? "Assignment";
    const name = project.residents.find((item) => item.id === assignment.residentId)?.name ?? assignment.residentId;
    const group = groups.get(label) ?? { category: rotation?.category ?? "other", names: [] };
    group.names.push(name);
    groups.set(label, group);
  }
  const sections = CATEGORY_ORDER.map((category) => {
    const rotations = [...groups.entries()]
      .filter(([, group]) => group.category === category)
      .map(([rotation, group]) => ({ rotation, names: group.names.sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => a.rotation.localeCompare(b.rotation));
    return { category, rotations, count: rotations.reduce((sum, rotation) => sum + rotation.names.length, 0) };
  }).filter((section) => section.count > 0);
  const width = 300;
  const maxHeight = 420;
  const left = x + 16 + width > window.innerWidth ? Math.max(8, x - width - 12) : x + 16;
  const below = y + 18;
  const top = window.innerHeight - below < 200 ? Math.max(8, y - Math.min(maxHeight, y - 8)) : below;
  const height = Math.min(maxHeight, window.innerHeight - top - 8);
  return (
    <div
      role="dialog"
      data-testid="day-roster"
      className="fixed z-30 flex flex-col border border-line bg-card text-[13px] shadow-sm"
      style={{ left, top, width, maxHeight: height }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="border-b border-line bg-head px-3 py-2">
        <div className="font-semibold text-navy">{formatDay(day)}</div>
        <div className="font-mono text-[12px] text-muted">{block ? `${block.label} · ${formatDay(block.startDate)} – ${formatDay(block.endDate)}` : ""}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {sections.length === 0 ? <p className="px-1 py-1">No assignments</p> : sections.map((section) => {
          const categoryOpen = openCategory === section.category;
          return (
            <section key={section.category} className="mb-1 border border-line">
              <button
                type="button"
                className="on-tint flex w-full items-center gap-2 px-2 py-1.5 text-left"
                style={{ background: categoryBackground(section.category) }}
                aria-expanded={categoryOpen}
                onClick={() => {
                  setOpenCategory(categoryOpen ? null : section.category);
                  setOpenRotation(null);
                }}
              >
                {categoryOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                <span className="font-semibold">{CATEGORY_LABEL[section.category]}</span>
                <span className="ml-auto font-mono text-[12px]">{section.count}</span>
              </button>
              {categoryOpen ? section.rotations.map((rotation) => {
                const rotationOpen = openRotation === rotation.rotation;
                return (
                  <div key={rotation.rotation} className="border-t border-line bg-card">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-head"
                      aria-expanded={rotationOpen}
                      onClick={() => setOpenRotation(rotationOpen ? null : rotation.rotation)}
                    >
                      {rotationOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                      <span className="min-w-0 flex-1">{rotation.rotation}</span>
                      <span className="font-mono text-[12px] text-muted">{rotation.names.length}</span>
                    </button>
                    {rotationOpen ? (
                      <ul className="border-t border-line px-3 py-1">
                        {rotation.names.map((name, index) => <li key={`${name}-${index}`} className="py-0.5">{name}</li>)}
                      </ul>
                    ) : null}
                  </div>
                );
              }) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
