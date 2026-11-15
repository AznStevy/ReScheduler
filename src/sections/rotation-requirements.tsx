import type { Project, Requirement, Resident, Rotation } from "@/domain/types";
import { newId } from "@/lib/cn";
import { useApp } from "@/state/store";
import { Button, Field, Modal, MoreOptions, NumberInput, Select, TextInput } from "@/ui/kit";
import { useState } from "react";

const PGY_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8];

function selectedYears(levels: number[]): number[] {
  return [...new Set(levels)].filter((level) => PGY_LEVELS.includes(level)).sort((left, right) => left - right);
}

function yearsAreContiguous(levels: number[]): boolean {
  const sorted = selectedYears(levels);
  return sorted.every((level, index) => index === 0 || level === sorted[index - 1] + 1);
}

function fillYears(from: number, through: number): number[] {
  const start = Math.min(from, through);
  const end = Math.max(from, through);
  return PGY_LEVELS.filter((level) => level >= start && level <= end);
}

function unitWord(amount: number, unit: Requirement["unit"]): string {
  const word = unit === "weeks" ? "week" : "block";
  return amount === 1 ? word : `${word}s`;
}

function audience(requirement: Requirement, residents: Resident[]): string {
  const ids = requirement.appliesTo.residentIds ?? [];
  if (ids.length) {
    const names = ids.map((id) => residents.find((person) => person.id === id)?.name ?? "A resident");
    if (names.length <= 2) return names.join(" and ");
    return `${names.length} residents`;
  }
  const years = selectedYears(requirement.appliesTo.pgy ?? []);
  if (years.length && !requirement.appliesTo.all) {
    if (years.length === 1) return `PGY-${years[0]}`;
    if (yearsAreContiguous(years)) return `PGY-${years[0]} through PGY-${years[years.length - 1]}`;
    return years.map((year) => `PGY-${year}`).join(", ");
  }
  const tracks = requirement.appliesTo.tracks ?? [];
  if (tracks.length && !requirement.appliesTo.all) return tracks.join(", ");
  return "all residents";
}

export function requirementNote(rotation: Rotation, project: Project): string {
  const linked = project.requirements.filter((item) => item.rotationIds.includes(rotation.id));
  if (!linked.length) return "";
  return linked.map((item) => (
    item.rotationIds.length === 1
      ? `Required: ${item.amount} ${unitWord(item.amount, item.unit)} for ${audience(item, project.residents)}`
      : `Counts toward ${item.name}`
  )).join(" · ");
}

function rotationNames(project: Project, ids: string[]): string {
  const names = ids.map((id) => project.rotations.find((rotation) => rotation.id === id)?.name ?? "Unknown rotation");
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

type Audience = "all" | "years" | "residents";

function audienceMode(requirement: Requirement): Audience {
  if ((requirement.appliesTo.residentIds?.length ?? 0) > 0) return "residents";
  if ((requirement.appliesTo.pgy?.length ?? 0) > 0 && !requirement.appliesTo.all) return "years";
  return "all";
}

function withAudience(requirement: Requirement, mode: Audience): Requirement {
  const tracks = requirement.appliesTo.tracks;
  const kept = requirement.scope === "accreditation" || requirement.scope === "institutional" ? requirement.scope : null;
  const trackPatch = tracks?.length ? { tracks } : {};
  if (mode === "all") return { ...requirement, scope: kept ?? "program", appliesTo: { all: true, ...trackPatch } };
  if (mode === "years") {
    const years = selectedYears(requirement.appliesTo.pgy ?? []);
    return { ...requirement, scope: kept ?? "pgy", appliesTo: { ...trackPatch, all: false, pgy: years.length ? years : [1] } };
  }
  return {
    ...requirement,
    scope: kept ?? "individual",
    appliesTo: { ...trackPatch, residentIds: requirement.appliesTo.residentIds ?? [] },
  };
}

function blankRequirement(): Requirement {
  return {
    id: newId("req"),
    name: "",
    description: "",
    scope: "program",
    unit: "blocks",
    amount: 1,
    appliesTo: { all: true },
    rotationIds: [],
    deadlineBlockId: null,
    priority: 1,
    relaxable: false,
    maxRelaxation: 0,
    maxPerYear: null,
  };
}

export function RotationRequirements() {
  const { snapshot, updateProject } = useApp();
  const project = snapshot.project;
  const [draft, setDraft] = useState<Requirement | null>(null);
  const [adding, setAdding] = useState(false);
  const close = () => { setDraft(null); setAdding(false); };
  return (
    <section className="border border-line bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <div>
          <h2 className="text-[14px] font-semibold">Requirements</h2>
          <p className="text-[13px] text-muted">How many times residents need to complete these rotations.</p>
        </div>
        <Button onClick={() => { setAdding(true); setDraft(blankRequirement()); }}>Add requirement</Button>
      </div>
      {project.requirements.length === 0 ? (
        <p className="px-3 py-3 text-[13px] text-muted">No requirements yet.</p>
      ) : (
        <ul>
          {project.requirements.map((requirement) => {
            const due = project.blocks.find((block) => block.id === requirement.deadlineBlockId)?.label;
            return (
              <li key={requirement.id} className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
                <div className="min-w-0">
                  <div className="font-semibold">{requirement.name}</div>
                  <div className="text-[13px] text-muted">
                    {requirement.amount} {unitWord(requirement.amount, requirement.unit)} · {audience(requirement, project.residents)} · {rotationNames(project, requirement.rotationIds) || "No rotation"}
                    {due ? ` · Due ${due}` : ""}
                  </div>
                </div>
                <Button variant="quiet" onClick={() => { setAdding(false); setDraft(requirement); }}>Edit</Button>
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={Boolean(draft)} title={adding ? "Add requirement" : draft?.name || "Requirement"} onClose={close}>
        {draft ? <RequirementEditor key={draft.id} requirement={draft} adding={adding} onChange={setDraft} onClose={close} onSave={(requirement) => {
          updateProject((current) => ({
            ...current,
            requirements: current.requirements.some((item) => item.id === requirement.id)
              ? current.requirements.map((item) => (item.id === requirement.id ? requirement : item))
              : [...current.requirements, requirement],
          }), `Saved requirement ${requirement.name}`);
          close();
        }} onRemove={() => {
          updateProject((current) => ({ ...current, requirements: current.requirements.filter((item) => item.id !== draft.id) }), `Removed ${draft.name}`);
          close();
        }} /> : null}
      </Modal>
    </section>
  );
}

function requirementHint(requirement: Requirement, project: Project): string {
  const parts: string[] = [];
  if (requirement.unit === "weeks") parts.push("Counted in weeks");
  if (audienceMode(requirement) !== "all") parts.push(audience(requirement, project.residents));
  const due = project.blocks.find((block) => block.id === requirement.deadlineBlockId)?.label;
  if (due) parts.push(`Due ${due}`);
  return parts.join(" · ");
}

function RequirementEditor({
  requirement,
  adding,
  onChange,
  onClose,
  onSave,
  onRemove,
}: {
  requirement: Requirement;
  adding: boolean;
  onChange: (requirement: Requirement) => void;
  onClose: () => void;
  onSave: (requirement: Requirement) => void;
  onRemove: () => void;
}) {
  const { snapshot } = useApp();
  const project = snapshot.project;
  const mode = audienceMode(requirement);
  const years = selectedYears(requirement.appliesTo.pgy ?? []);
  const gapped = years.length > 1 && !yearsAreContiguous(years);
  const from = years[0] ?? 1;
  const through = years[years.length - 1] ?? from;
  const set = (patch: Partial<Requirement>) => onChange({ ...requirement, ...patch });
  const setYears = (next: number[]) => onChange(withAudience({ ...requirement, appliesTo: { ...requirement.appliesTo, pgy: selectedYears(next) } }, "years"));
  const named = requirement.name.trim().length > 0;
  const linked = requirement.amount <= 0 || requirement.rotationIds.length > 0;
  const hasAudience = mode !== "residents" || (requirement.appliesTo.residentIds?.length ?? 0) > 0;
  const hasYears = mode !== "years" || years.length > 0;
  const rotationName = (id: string) => project.rotations.find((rotation) => rotation.id === id)?.name ?? "Unknown rotation";
  const residentName = (id: string) => project.residents.find((resident) => resident.id === id)?.name ?? "A resident";
  const amountLabel = requirement.unit === "weeks" ? "Weeks" : "Blocks";
  const hint = requirementHint(requirement, project);
  return (
    <div className="grid gap-3">
      <Field label="Name"><TextInput className="w-full" value={requirement.name} onChange={(event) => set({ name: event.target.value })} /></Field>
      <Field label={amountLabel}><NumberInput value={requirement.amount} onChange={(event) => set({ amount: Number(event.target.value) || 0 })} /></Field>
      <Field label="Rotations that count">
        <Select className="w-full" value="" onChange={(event) => { if (event.target.value && !requirement.rotationIds.includes(event.target.value)) set({ rotationIds: [...requirement.rotationIds, event.target.value] }); }}>
          <option value="">Add a rotation</option>
          {project.rotations.map((rotation) => <option key={rotation.id} value={rotation.id}>{rotation.name}</option>)}
        </Select>
      </Field>
      <div className="flex flex-wrap gap-1">
        {requirement.rotationIds.map((id) => (
          <button key={id} type="button" className="h-6 border border-line bg-head px-1.5 text-[12px]" onClick={() => set({ rotationIds: requirement.rotationIds.filter((item) => item !== id) })}>{rotationName(id)}</button>
        ))}
      </div>
      <MoreOptions initiallyOpen={hint.length > 0} hint={hint}>
        <Field label="Counted as">
          <Select className="w-full" value={requirement.unit} onChange={(event) => set({ unit: event.target.value === "weeks" ? "weeks" : "blocks" })}>
            <option value="blocks">Blocks</option>
            <option value="weeks">Weeks</option>
          </Select>
        </Field>
        <Field label="Applies to">
          <Select className="w-full" value={mode} onChange={(event) => onChange(withAudience(requirement, event.target.value as Audience))}>
            <option value="all">All residents</option>
            <option value="years">Specific years</option>
            <option value="residents">Specific residents</option>
          </Select>
        </Field>
        {mode === "years" ? (
          gapped ? (
            <div className="flex flex-wrap gap-1">
              {PGY_LEVELS.map((level) => {
                const on = years.includes(level);
                return (
                  <button key={level} type="button" aria-pressed={on} className={`h-8 w-8 border text-[13px] font-semibold ${on ? "border-navy bg-navy text-white" : "border-line bg-card text-ink"}`} onClick={() => setYears(on ? years.filter((item) => item !== level) : [...years, level])}>{level}</button>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From">
                <Select className="w-full" value={String(from)} onChange={(event) => setYears(fillYears(Number(event.target.value), Math.max(through, Number(event.target.value))))}>
                  {PGY_LEVELS.map((level) => <option key={level} value={level}>PGY-{level}</option>)}
                </Select>
              </Field>
              <Field label="Through">
                <Select className="w-full" value={String(through)} onChange={(event) => setYears(fillYears(from, Number(event.target.value)))}>
                  {PGY_LEVELS.map((level) => <option key={level} value={level}>PGY-{level}</option>)}
                </Select>
              </Field>
            </div>
          )
        ) : null}
        {mode === "residents" ? (
          <>
            <Field label="Residents">
              <Select className="w-full" value="" onChange={(event) => {
                const id = event.target.value;
                const current = requirement.appliesTo.residentIds ?? [];
                if (id && !current.includes(id)) onChange({ ...requirement, appliesTo: { ...requirement.appliesTo, residentIds: [...current, id] } });
              }}>
                <option value="">Add a resident</option>
                {project.residents.map((resident) => <option key={resident.id} value={resident.id}>{resident.name}</option>)}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-1">
              {(requirement.appliesTo.residentIds ?? []).map((id) => (
                <button key={id} type="button" className="h-6 border border-line bg-head px-1.5 text-[12px]" onClick={() => onChange({ ...requirement, appliesTo: { ...requirement.appliesTo, residentIds: (requirement.appliesTo.residentIds ?? []).filter((item) => item !== id) } })}>{residentName(id)}</button>
              ))}
            </div>
          </>
        ) : null}
        <Field label="Due by">
          <Select className="w-full" value={requirement.deadlineBlockId ?? ""} onChange={(event) => set({ deadlineBlockId: event.target.value || null })}>
            <option value="">No deadline this year</option>
            {project.blocks.map((block) => <option key={block.id} value={block.id}>{block.label}</option>)}
          </Select>
        </Field>
      </MoreOptions>
      {requirement.amount > 0 && requirement.rotationIds.length === 0 ? <p className="text-[13px]">Choose at least one rotation this requirement counts.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onSave({ ...requirement, name: requirement.name.trim(), description: requirement.description || requirement.name.trim() })} disabled={!named || !linked || !hasAudience || !hasYears}>Save requirement</Button>
        {adding ? <Button variant="quiet" onClick={onClose}>Cancel</Button> : <Button variant="danger" onClick={onRemove}>Remove</Button>}
      </div>
    </div>
  );
}
