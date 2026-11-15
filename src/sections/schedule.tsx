import { forcedChoice } from "@/domain/eligibility";
import type { Assignment, Resident, Rotation } from "@/domain/types";
import { categoryBackground, rotationAbbrev } from "@/ui/abbrev";
import { useApp } from "@/state/store";
import { BlockCalendar } from "@/ui/block-calendar";
import { Button, Field, Modal, Select, TextInput } from "@/ui/kit";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ListFilter, Lock, Redo2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

type LockAxis = "resident" | "block";

interface LockDrag {
  axis: LockAxis;
  anchor: string;
  current: string;
}

function rangeIds(ids: string[], anchor: string, current: string): string[] {
  const start = ids.indexOf(anchor);
  const end = ids.indexOf(current);
  if (start < 0 || end < 0) return [anchor];
  const [from, to] = start < end ? [start, end] : [end, start];
  return ids.slice(from, to + 1);
}

function lockTargetAt(x: number, y: number, axis: LockAxis): string | null {
  const node = document.elementFromPoint(x, y);
  if (!(node instanceof Element)) return null;
  const header = axis === "resident" ? "data-lock-row" : "data-lock-col";
  const cell = axis === "resident" ? "data-cell-resident" : "data-cell-block";
  const match = node.closest(`[${header}], [${cell}]`);
  if (!(match instanceof HTMLElement)) return null;
  return match.getAttribute(header) ?? match.getAttribute(cell);
}

export function ScheduleSection() {
  const { snapshot, setAssignments, updateProject, undo, redo, canUndo, canRedo, setNotice } = useApp();
  const { project, versions } = snapshot;
  const [pgy, setPgy] = useState("all");
  const [track, setTrack] = useState("all");
  const [query, setQuery] = useState("");
  const [rotationFilter, setRotationFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [compare, setCompare] = useState(false);
  const [editing, setEditing] = useState<{ residentId: string; blockId: string } | null>(null);
  const [focus, setFocus] = useState<{ r: number; b: number } | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [lockDrag, setLockDrag] = useState<LockDrag | null>(null);
  const lockDragRef = useRef<(LockDrag & { moved: boolean }) | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const activeFilters = (pgy !== "all" ? 1 : 0) + (track !== "all" ? 1 : 0) + (rotationFilter !== "all" ? 1 : 0);
  const tracks = [...new Set(project.residents.map((resident) => resident.track))];
  const previous = versions[0]?.assignments ?? [];
  const rotationText = useMemo(() => {
    const names = new Map(project.rotations.map((rotation) => [rotation.id, `${rotation.name} ${rotationAbbrev(rotation)}`.toLowerCase()]));
    const byResident = new Map<string, string>();
    for (const assignment of project.assignments) {
      const text = names.get(assignment.rotationId) ?? "";
      const extra = (assignment.duties ?? []).map((duty) => duty.name).join(" ");
      byResident.set(assignment.residentId, `${byResident.get(assignment.residentId) ?? ""} ${text} ${extra}`);
    }
    return byResident;
  }, [project.assignments, project.rotations]);
  const needle = query.trim().toLowerCase();
  const residents = project.residents.filter((resident) => {
    if (pgy !== "all" && String(resident.pgy) !== pgy) return false;
    if (track !== "all" && resident.track !== track) return false;
    if (rotationFilter !== "all" && !project.assignments.some((item) => item.residentId === resident.id && item.rotationId === rotationFilter)) return false;
    if (!needle) return true;
    const haystack = `${resident.name} ${resident.id} ${resident.track} pgy-${resident.pgy} p${resident.pgy} ${rotationText.get(resident.id) ?? ""}`.toLowerCase();
    return haystack.includes(needle);
  });
  const virtualizer = useVirtualizer({ count: residents.length, getScrollElement: () => parentRef.current, estimateSize: () => 36, overscan: 10 });
  const width = 220 + project.blocks.length * 96;
  useEffect(() => {
    if (focus) virtualizer.scrollToIndex(focus.r, { align: "auto" });
  }, [focus, virtualizer]);
  useEffect(() => {
    if (!filtersOpen) return;
    function onPointer(event: MouseEvent) {
      if (!filterRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    }
    function onEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setFiltersOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onEscape);
    };
  }, [filtersOpen]);

  function cell(residentId: string, blockId: string) {
    return project.assignments.find((item) => item.residentId === residentId && item.blockId === blockId);
  }

  function write(residentId: string, blockId: string, rotationId: string, locked = false) {
    const resident = project.residents.find((item) => item.id === residentId);
    const block = project.blocks.find((item) => item.id === blockId);
    if (!resident || !block) return;
    if (resident.locked) {
      setNotice(`${resident.name}'s schedule is locked.`);
      return;
    }
    if (block.locked) {
      setNotice(`${block.label} is locked.`);
      return;
    }
    const forced = forcedChoice(project, resident, blockId);
    if (forced.rotationId && forced.rotationId !== rotationId) {
      setNotice(`${resident.name}: locked assignment in ${block.label}.`);
      return;
    }
    const previous = project.assignments.find((item) => item.residentId === residentId && item.blockId === blockId);
    const next = project.assignments.filter((item) => item.residentId !== residentId || item.blockId !== blockId);
    if (rotationId) {
      next.push({
        residentId,
        blockId,
        rotationId,
        locked,
        source: locked ? "locked" : "manual",
        ...(previous?.duties?.length ? { duties: previous.duties } : {}),
      });
    }
    setAssignments(next);
  }

  function onDrop(targetResident: string, targetBlock: string, event: DragEvent) {
    event.preventDefault();
    const [fromResident, fromBlock] = event.dataTransfer.getData("text/plain").split("|");
    if (!fromResident || !fromBlock || (fromResident === targetResident && fromBlock === targetBlock)) return;
    const source = cell(fromResident, fromBlock);
    const target = cell(targetResident, targetBlock);
    const sourceBlock = project.blocks.find((item) => item.id === fromBlock);
    const targetBlockRecord = project.blocks.find((item) => item.id === targetBlock);
    const sourceResident = project.residents.find((item) => item.id === fromResident);
    const targetResidentRecord = project.residents.find((item) => item.id === targetResident);
    if (sourceResident?.locked || targetResidentRecord?.locked) {
      setNotice("That resident's schedule is locked.");
      return;
    }
    if (sourceBlock?.locked || targetBlockRecord?.locked) {
      setNotice("That block is locked.");
      return;
    }
    if (source?.locked || target?.locked) {
      setNotice("Locked assignment.");
      return;
    }
    const next = project.assignments.map((item) => ({ ...item }));
    const left = next.find((item) => item.residentId === fromResident && item.blockId === fromBlock);
    const right = next.find((item) => item.residentId === targetResident && item.blockId === targetBlock);
    if (left && right) {
      const rotationId = left.rotationId;
      left.rotationId = right.rotationId;
      right.rotationId = rotationId;
      left.source = "manual";
      right.source = "manual";
    } else if (left) {
      left.residentId = targetResident;
      left.blockId = targetBlock;
      left.source = "manual";
    }
    setAssignments(next);
  }

  function onKey(event: KeyboardEvent) {
    if (!residents.length || !project.blocks.length) return;
    const current = focus ?? { r: 0, b: 0 };
    if (event.key === "ArrowRight") { event.preventDefault(); setFocus({ r: current.r, b: Math.min(project.blocks.length - 1, current.b + 1) }); }
    if (event.key === "ArrowLeft") { event.preventDefault(); setFocus({ r: current.r, b: Math.max(0, current.b - 1) }); }
    if (event.key === "ArrowDown") { event.preventDefault(); setFocus({ r: Math.min(residents.length - 1, current.r + 1), b: current.b }); }
    if (event.key === "ArrowUp") { event.preventDefault(); setFocus({ r: Math.max(0, current.r - 1), b: current.b }); }
    if (event.key === "Enter") {
      const person = residents[current.r];
      const column = project.blocks[current.b];
      if (person && column) setEditing({ residentId: person.id, blockId: column.id });
    }
  }

  function toggleBlockLock(blockId: string) {
    const target = project.blocks.find((item) => item.id === blockId);
    if (!target) return;
    const locked = !target.locked;
    updateProject((current) => ({
      ...current,
      blocks: current.blocks.map((item) => item.id === blockId ? { ...item, locked } : item),
    }), locked ? `Locked ${target.label}` : `Unlocked ${target.label}`);
  }

  function toggleResidentLock(residentId: string) {
    const target = project.residents.find((item) => item.id === residentId);
    if (!target) return;
    const locked = !target.locked;
    updateProject((current) => ({
      ...current,
      residents: current.residents.map((item) => item.id === residentId ? { ...item, locked } : item),
    }), locked ? `Locked ${target.name}'s schedule` : `Unlocked ${target.name}'s schedule`);
  }

  function beginLockDrag(axis: LockAxis, id: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const anchorLocked = axis === "block"
      ? Boolean(project.blocks.find((item) => item.id === id)?.locked)
      : Boolean(residents.find((person) => person.id === id)?.locked);
    const locked = !anchorLocked;
    const drag = { axis, anchor: id, current: id, moved: false };
    lockDragRef.current = drag;
    setLockDrag({ axis, anchor: id, current: id });
    const move = (ev: PointerEvent) => {
      const active = lockDragRef.current;
      if (!active) return;
      const scroller = parentRef.current;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        if (active.axis === "resident") {
          if (ev.clientY < rect.top + 48) scroller.scrollTop -= 24;
          else if (ev.clientY > rect.bottom - 28) scroller.scrollTop += 24;
        } else if (ev.clientX > rect.right - 28) scroller.scrollLeft += 28;
        else if (ev.clientX < rect.left + 248) scroller.scrollLeft -= 28;
      }
      const hit = lockTargetAt(ev.clientX, ev.clientY, active.axis);
      if (!hit || hit === active.current) return;
      active.current = hit;
      active.moved = true;
      setLockDrag({ axis: active.axis, anchor: active.anchor, current: hit });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const active = lockDragRef.current;
      lockDragRef.current = null;
      setLockDrag(null);
      if (!active) return;
      const order = active.axis === "resident" ? residents.map((person) => person.id) : project.blocks.map((item) => item.id);
      const ids = active.moved ? rangeIds(order, active.anchor, active.current) : [active.anchor];
      if (!active.moved || ids.length < 2) {
        if (active.axis === "block") toggleBlockLock(active.anchor);
        else toggleResidentLock(active.anchor);
        return;
      }
      if (active.axis === "block") {
        updateProject((current) => ({
          ...current,
          blocks: current.blocks.map((item) => ids.includes(item.id) ? { ...item, locked } : item),
        }), `${locked ? "Locked" : "Unlocked"} ${ids.length} blocks`);
      } else {
        updateProject((current) => ({
          ...current,
          residents: current.residents.map((item) => ids.includes(item.id) ? { ...item, locked } : item),
        }), `${locked ? "Locked" : "Unlocked"} ${ids.length} schedules`);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function dragCovers(axis: LockAxis, id: string): boolean {
    if (!lockDrag || lockDrag.axis !== axis) return false;
    const order = axis === "resident" ? residents.map((person) => person.id) : project.blocks.map((item) => item.id);
    return rangeIds(order, lockDrag.anchor, lockDrag.current).includes(id);
  }
  const resident = project.residents.find((item) => item.id === editing?.residentId);
  const block = project.blocks.find((item) => item.id === editing?.blockId);
  const selected = project.blocks.find((item) => item.id === selectedBlock) ?? null;

  return (
    <div className="schedule-layout flex min-h-0 flex-1 flex-col gap-3">
      <div className="no-print flex shrink-0 flex-wrap items-end gap-3">
        <Field label="Search">
          <TextInput className="w-72" value={query} placeholder="Name, year, track, or rotation" onChange={(event) => setQuery(event.target.value)} />
        </Field>
        <div className="relative" ref={filterRef}>
          <Button variant="quiet" aria-expanded={filtersOpen} aria-controls="schedule-filters" onClick={() => setFiltersOpen((open) => !open)}>
            <ListFilter className="h-3.5 w-3.5" /> Filter{activeFilters ? ` (${activeFilters})` : ""}
          </Button>
          {filtersOpen ? (
            <div id="schedule-filters" className="absolute left-0 top-full z-40 mt-1 grid w-72 gap-3 border border-line bg-card p-3">
              <Field label="PGY">
                <Select value={pgy} onChange={(event) => setPgy(event.target.value)}>
                  <option value="all">All</option>
                  {Array.from({ length: Math.max(8, ...project.residents.map((resident) => resident.pgy), 1) }, (_, index) => index + 1).map((level) => <option key={level} value={level}>PGY-{level}</option>)}
                </Select>
              </Field>
              <Field label="Track">
                <Select value={track} onChange={(event) => setTrack(event.target.value)}>
                  <option value="all">All</option>
                  {tracks.map((item) => <option key={item}>{item}</option>)}
                </Select>
              </Field>
              <Field label="Rotation">
                <Select value={rotationFilter} onChange={(event) => setRotationFilter(event.target.value)}>
                  <option value="all">All</option>
                  {project.rotations.map((rotation) => <option key={rotation.id} value={rotation.id}>{rotation.name}</option>)}
                </Select>
              </Field>
              <Button variant="quiet" disabled={!activeFilters} onClick={() => { setPgy("all"); setTrack("all"); setRotationFilter("all"); }}>Clear</Button>
            </div>
          ) : null}
        </div>
        <Button variant="quiet" onClick={undo} disabled={!canUndo}><Undo2 className="h-3.5 w-3.5" /> Undo</Button>
        <Button variant="quiet" onClick={redo} disabled={!canRedo}><Redo2 className="h-3.5 w-3.5" /> Redo</Button>
        <Button variant="quiet" onClick={() => setCompare((value) => !value)} disabled={!versions.length}>{compare ? "Current" : "Compare"}</Button>
        <Button variant="quiet" onClick={() => window.print()}>Print</Button>
        {selected ? (
          <Button variant="quiet" onClick={() => toggleBlockLock(selected.id)}>
            <Lock className="h-3.5 w-3.5" /> {selected.locked ? "Unlock block" : "Lock block"}
          </Button>
        ) : null}
      </div>
      <div className="shrink-0">
        <BlockCalendar variant="strip" project={project} selectedId={selectedBlock} onSelect={(blockId) => setSelectedBlock((current) => current === blockId ? null : blockId)} />
      </div>
      {project.assignments.length === 0 ? <p className="shrink-0 text-[14px]">No schedule generated.</p> : null}
      {project.residents.length > 0 && residents.length === 0 ? <p className="shrink-0 text-[14px]">No residents match.</p> : null}
      <div ref={parentRef} tabIndex={0} onKeyDown={onKey} className="print-area min-h-0 flex-1 overflow-auto border border-line bg-card outline-none">
        <div style={{ width }}>
          <div className="sticky top-0 z-20 flex border-b border-line bg-head">
            <div className="sticky left-0 z-30 flex w-[220px] shrink-0 items-center border-r border-line bg-head px-3 text-[13px] font-semibold">Resident</div>
            {project.blocks.map((item) => (
              <div key={item.id} data-lock-col={item.id} className={`flex h-11 w-[96px] shrink-0 items-center ${dragCovers("block", item.id) ? "bg-steel/30" : selectedBlock === item.id ? "bg-navy text-white" : ""}`}>
                <button
                  type="button"
                  onClick={() => setSelectedBlock((current) => current === item.id ? null : item.id)}
                  className="flex min-w-0 flex-1 flex-col justify-center px-2 text-left font-mono text-[12px] leading-tight"
                >
                  <div>{item.id.toUpperCase()}</div>
                  <div className={selectedBlock === item.id && !dragCovers("block", item.id) ? "on-navy-soft" : "text-muted"}>{item.holiday ? "HOL" : item.startDate.slice(5)}</div>
                </button>
                <button
                  type="button"
                  aria-pressed={Boolean(item.locked)}
                  aria-label={item.locked ? `Unlock block ${item.id.toUpperCase()}` : `Lock block ${item.id.toUpperCase()}`}
                  title="Click to lock or unlock this block. Drag across the columns to do the same to several."
                  onPointerDown={(event) => beginLockDrag("block", item.id, event)}
                  className="mr-1 grid h-6 w-6 shrink-0 touch-none place-items-center"
                >
                  <Lock className={`h-3 w-3 ${item.locked || dragCovers("block", item.id) ? "" : "opacity-40"}`} />
                </button>
              </div>
            ))}
          </div>
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const person = residents[item.index];
              return (
                <div key={person.id} className="absolute left-0 flex border-b border-line" style={{ top: item.start, height: item.size, width }}>
                  <div data-lock-row={person.id} className={`sticky left-0 z-10 flex w-[220px] shrink-0 items-center gap-1 border-r border-line px-2 text-[13px] ${dragCovers("resident", person.id) ? "bg-steel/25" : "bg-card"}`}>
                    <span className="min-w-0 flex-1 truncate font-semibold">{person.name}</span>
                    <span className="font-mono text-[11px] text-muted">P{person.pgy}</span>
                    <button
                      type="button"
                      aria-pressed={Boolean(person.locked)}
                      aria-label={person.locked ? `Unlock ${person.name}'s schedule` : `Lock ${person.name}'s schedule`}
                      title="Click to lock or unlock this resident. Drag across the rows to do the same to several."
                      onPointerDown={(event) => beginLockDrag("resident", person.id, event)}
                      className="grid h-6 w-6 shrink-0 touch-none place-items-center"
                    >
                      <Lock className={`h-3 w-3 ${person.locked || dragCovers("resident", person.id) ? "" : "opacity-40"}`} />
                    </button>
                  </div>
                  {project.blocks.map((column, blockIndex) => {
                    const assignment = cell(person.id, column.id);
                    const rotation = project.rotations.find((entry) => entry.id === assignment?.rotationId);
                    const duties = assignment?.duties ?? [];
                    const changed = compare && (previous.find((entry) => entry.residentId === person.id && entry.blockId === column.id)?.rotationId ?? "") !== (assignment?.rotationId ?? "");
                    const active = focus?.r === item.index && focus.b === blockIndex;
                    const marked = selectedBlock === column.id;
                    const blockLocked = Boolean(column.locked);
                    const scheduleLocked = Boolean(person.locked);
                    const frozen = blockLocked || scheduleLocked;
                    const painted = dragCovers("resident", person.id) || dragCovers("block", column.id);
                    return (
                      <button
                        key={column.id}
                        data-cell-resident={person.id}
                        data-cell-block={column.id}
                        title={rotation ? `${rotation.name}${duties.length ? ` · Also ${duties.map((duty) => `${duty.date.slice(5)} ${duty.name}`).join(", ")}` : ""}${scheduleLocked ? " · Locked schedule" : blockLocked ? " · Locked block" : assignment?.locked ? " · Locked" : ""}` : scheduleLocked ? "Locked schedule" : blockLocked ? "Locked block" : "Unassigned"}
                        draggable={Boolean(assignment) && !assignment?.locked && !frozen && !lockDrag}
                        onDragStart={(event) => event.dataTransfer.setData("text/plain", `${person.id}|${column.id}`)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => onDrop(person.id, column.id, event)}
                        onClick={() => { setFocus({ r: item.index, b: blockIndex }); setEditing({ residentId: person.id, blockId: column.id }); }}
                        className="on-tint flex h-9 w-[96px] shrink-0 items-center justify-between border-l border-line px-2 font-mono text-[13px]"
                        style={{
                          background: rotation ? categoryBackground(rotation.category) : "#fff",
                          boxShadow: painted ? "inset 0 0 0 2px #477587" : changed ? "inset 0 0 0 2px #b47b42" : active || marked ? "inset 0 0 0 2px #355c6e" : undefined,
                        }}
                      >
                        <span className="truncate">{rotation ? rotationAbbrev(rotation) : ""}</span>
                        {duties.length ? <span className="on-tint-soft shrink-0 text-[10px]">+{dutyMark(duties)}</span> : null}
                        {assignment?.locked || frozen ? <Lock className="h-3 w-3" aria-label={scheduleLocked ? "Locked schedule" : blockLocked ? "Locked block" : "Locked"} /> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <Modal open={Boolean(resident && block)} title={resident && block ? `${resident.name} · ${block.id.toUpperCase()}` : "Assignment"} onClose={() => setEditing(null)}>
        {resident && block ? (
          <AssignmentEditor
            resident={resident}
            assignment={cell(resident.id, block.id)}
            rotations={project.rotations}
            blockLocked={Boolean(block.locked)}
            scheduleLocked={Boolean(resident.locked)}
            onSave={(rotationId, locked) => {
              write(resident.id, block.id, rotationId, locked);
              setEditing(null);
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function dutyMark(duties: { name: string }[]): string {
  const names = [...new Set(duties.map((duty) => duty.name))];
  if (names.length !== 1) return String(duties.length);
  const initials = names[0].split(/[^A-Za-z0-9]+/).filter(Boolean).map((word) => word[0]).join("").toUpperCase();
  return (initials || names[0]).replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 3);
}

function AssignmentEditor({
  resident,
  assignment,
  rotations,
  blockLocked,
  scheduleLocked,
  onSave,
}: {
  resident: Resident;
  assignment?: Assignment;
  rotations: Rotation[];
  blockLocked: boolean;
  scheduleLocked: boolean;
  onSave: (rotationId: string, locked: boolean) => void;
}) {
  const [rotationId, setRotationId] = useState(assignment?.rotationId ?? "");
  const [locked, setLocked] = useState(assignment?.locked ?? false);
  const frozen = blockLocked || scheduleLocked;
  const choices = rotations.filter((rotation) => rotation.eligiblePgy.includes(resident.pgy) && (rotation.eligibleTracks.length === 0 || rotation.eligibleTracks.includes(resident.track)) && !resident.restrictions.includes(rotation.id));
  return (
    <div className="grid gap-2">
      <Field label="Rotation">
        <Select value={rotationId} disabled={frozen} onChange={(event) => setRotationId(event.target.value)}>
          <option value="">Unassigned</option>
          {choices.map((rotation) => <option key={rotation.id} value={rotation.id}>{rotationAbbrev(rotation)} · {rotation.name}</option>)}
        </Select>
      </Field>
      {assignment?.duties?.length ? (
        <div className="grid gap-1 text-[13px]">
          <p className="font-semibold">Also on this block</p>
          <ul className="grid gap-1">
            {assignment.duties.map((duty) => <li key={`${duty.date}-${duty.name}`} className="font-mono text-[12px]">{duty.date} · {duty.name}</li>)}
          </ul>
          <p className="text-muted">Imported on top of this block. Generation leaves these days as they are.</p>
        </div>
      ) : null}
      {scheduleLocked ? <p className="text-[13px] text-muted">This resident's schedule is locked, so these assignments stay as they are.</p> : blockLocked ? <p className="text-[13px] text-muted">This block is locked, so these assignments stay as they are.</p> : (
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={locked} onChange={(event) => setLocked(event.target.checked)} /> Locked</label>
      )}
      <Button onClick={() => onSave(rotationId, locked && Boolean(rotationId))} disabled={frozen}>Save</Button>
    </div>
  );
}
