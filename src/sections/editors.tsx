import { blockRangeLabel, editBlockDate } from "@/domain/calendar";
import { matchingRotationNames } from "@/domain/career";
import { vacationCapacity } from "@/domain/lookups";
import type { Block, CareerInterest, Project, Resident, Rotation, RotationCategory, VacationRequest } from "@/domain/types";
import { newId } from "@/lib/cn";
import { RotationRequirements, requirementNote } from "@/sections/rotation-requirements";
import { useApp } from "@/state/store";
import { categoryBackground } from "@/ui/abbrev";
import { formatDay } from "@/ui/block-calendar";
import { Button, Card, Field, Modal, MoreOptions, NumberInput, Select, TextInput } from "@/ui/kit";
import { useState } from "react";

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

const CATEGORIES = Object.keys(CATEGORY_LABEL) as RotationCategory[];

function yearLabel(levels: number[]): string {
  const sorted = [...new Set(levels)].filter((level) => level > 0).sort((a, b) => a - b);
  if (!sorted.length) return "No years selected";
  if (sorted.length >= 8 && sorted[0] === 1 && sorted[sorted.length - 1] >= 8) return "All years";
  const contiguous = sorted.every((level, index) => index === 0 || level === sorted[index - 1] + 1);
  if (contiguous && sorted.length > 1) return `PGY ${sorted[0]}–${sorted[sorted.length - 1]}`;
  return `PGY ${sorted.join(", ")}`;
}

function staffingSummary(rotation: Rotation): string {
  if (!rotation.staffing.length) return "No staffing limits";
  const mins = new Set(rotation.staffing.map((cell) => cell.min));
  const maxes = new Set(rotation.staffing.map((cell) => cell.max));
  if (mins.size === 1 && maxes.size === 1) return `${[...mins][0]}–${[...maxes][0]} each block`;
  return "Staffing varies by block";
}

function pairs(value: string): [string, string][] {
  return value.split(";").map((item) => item.trim()).filter(Boolean).map((item) => {
    const [left, right] = item.split(":");
    return [(left ?? "").trim(), (right ?? "").trim()] as [string, string];
  }).filter(([left]) => left);
}

function withBlockVacation(project: Project, blockId: string, capacity: number): Project {
  const rules = project.vacationRules;
  const blocked = capacity <= 0;
  const matchesDefault = capacity === rules.defaultCapacity;
  return {
    ...project,
    vacationRules: {
      ...rules,
      blackoutBlockIds: blocked ? [...new Set([...rules.blackoutBlockIds, blockId])] : rules.blackoutBlockIds.filter((id) => id !== blockId),
      capacityByBlock: blocked || matchesDefault
        ? rules.capacityByBlock.filter((item) => item.blockId !== blockId)
        : [...rules.capacityByBlock.filter((item) => item.blockId !== blockId), { blockId, capacity }],
    },
  };
}

function blankResident(): Resident {
  return {
    id: newId("r"),
    name: "",
    pgy: 1,
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

export function ResidentsSection() {
  const { snapshot, updateProject, selected, toggleSelected, setSelected } = useApp();
  const project = snapshot.project;
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Resident | null>(null);
  const [bulkPgy, setBulkPgy] = useState(1);
  const [bulkTrack, setBulkTrack] = useState("Categorical");
  const residents = snapshot.project.residents.filter((resident) => `${resident.name} ${resident.id}`.toLowerCase().includes(query.toLowerCase()));

  function save(resident: Resident, interests: CareerInterest[] = []) {
    updateProject((project) => {
      const known = new Set(project.interests.map((item) => item.id));
      return {
        ...project,
        interests: [...project.interests, ...interests.filter((item) => !known.has(item.id))],
        residents: project.residents.some((item) => item.id === resident.id)
          ? project.residents.map((item) => (item.id === resident.id ? resident : item))
          : [...project.residents, resident],
      };
    }, `Saved resident ${resident.name}`);
    setDraft(null);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Search"><TextInput value={query} onChange={(event) => setQuery(event.target.value)} /></Field>
        <Button onClick={() => setDraft(blankResident())}>Add resident</Button>
      </div>
      {selected.length ? (
        <Card title={`${selected.length} selected`}>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="PGY"><NumberInput value={bulkPgy} onChange={(event) => setBulkPgy(Number(event.target.value) || 1)} /></Field>
            <Button variant="quiet" onClick={() => updateProject((project) => ({ ...project, residents: project.residents.map((resident) => selected.includes(resident.id) ? { ...resident, pgy: bulkPgy } : resident) }), "Bulk PGY edit")}>Apply PGY</Button>
            <Field label="Track"><TextInput value={bulkTrack} onChange={(event) => setBulkTrack(event.target.value)} /></Field>
            <Button variant="quiet" onClick={() => updateProject((project) => ({ ...project, residents: project.residents.map((resident) => selected.includes(resident.id) ? { ...resident, track: bulkTrack } : resident) }), "Bulk track edit")}>Apply track</Button>
            <Button variant="quiet" onClick={() => updateProject((project) => ({ ...project, residents: project.residents.map((resident) => selected.includes(resident.id) ? { ...resident, lockedAssignments: [], locked: undefined } : resident) }), "Cleared locks")}>Clear locks</Button>
            <Button variant="danger" onClick={() => { updateProject((project) => ({ ...project, residents: project.residents.filter((resident) => !selected.includes(resident.id)), assignments: project.assignments.filter((item) => !selected.includes(item.residentId)), vacations: project.vacations.filter((item) => !selected.includes(item.residentId)) }), "Removed residents"); setSelected([]); }}>Remove</Button>
          </div>
        </Card>
      ) : null}
      {residents.length === 0 ? <p className="text-[13px]">No residents added.</p> : (
        <div className="overflow-auto border border-line bg-card">
          <table className="data-table w-full min-w-[920px] text-left text-[14px]">
            <thead className="bg-head">
              <tr>
                <th className="w-8 px-2 py-1"></th>
                <th className="px-2 py-1">Resident Name</th>
                <th className="px-2 py-1">PGY</th>
                <th className="px-2 py-1">Track</th>
                <th className="px-2 py-1">Graduation</th>
                <th className="px-2 py-1">Career Interest</th>
                <th className="px-2 py-1">Requests</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {residents.map((resident) => (
                <tr key={resident.id} className={`border-t border-line ${selected.includes(resident.id) ? "bg-steel/10" : ""}`}>
                  <td className="px-2"><input type="checkbox" checked={selected.includes(resident.id)} onChange={() => toggleSelected(resident.id)} aria-label={`Select ${resident.name}`} /></td>
                  <td className="px-2 py-1 font-semibold">{resident.name}{resident.locked ? <span className="ml-2 text-[12px] font-normal text-muted">Locked</span> : null}<div className="font-mono text-[11px] text-muted">{resident.id}</div></td>
                  <td className="px-2 font-mono">{resident.pgy}</td>
                  <td className="px-2">{resident.track}</td>
                  <td className="whitespace-nowrap px-2">{resident.graduationDate}</td>
                  <td className="px-2">{resident.careerInterests.map((item) => snapshot.project.interests.find((interest) => interest.id === item.interestId)?.name ?? item.interestId).join(", ")}</td>
                  <td className="px-2 font-mono">{project.vacations.filter((vacation) => vacation.residentId === resident.id).length}</td>
                  <td className="px-2"><Button variant="quiet" onClick={() => setDraft(resident)}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal wide open={Boolean(draft)} title={draft?.name || "Resident"} onClose={() => setDraft(null)}>
        {draft ? <ResidentForm resident={draft} onChange={setDraft} onSave={(interests) => save(draft, interests)} /> : null}
      </Modal>
    </div>
  );
}

function ResidentForm({ resident, onChange, onSave }: { resident: Resident; onChange: (resident: Resident) => void; onSave: (interests: CareerInterest[]) => void }) {
  const { snapshot, updateProject } = useApp();
  const [tab, setTab] = useState<"profile" | "career" | "vacation" | "record">("profile");
  const [interestName, setInterestName] = useState("");
  const [addedInterests, setAddedInterests] = useState<CareerInterest[]>([]);
  const interests = [
    ...snapshot.project.interests,
    ...addedInterests.filter((item) => !snapshot.project.interests.some((existing) => existing.id === item.id)),
  ];
  const set = (patch: Partial<Resident>) => onChange({ ...resident, ...patch });
  function addCareerInterest() {
    const name = interestName.trim();
    if (!name) return;
    const existing = interests.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const interest = existing ?? { id: newId("interest"), name };
    if (!existing) setAddedInterests((current) => [...current, interest]);
    if (!resident.careerInterests.some((item) => item.interestId === interest.id)) {
      set({ careerInterests: [...resident.careerInterests, { interestId: interest.id, rank: resident.careerInterests.length + 1 }] });
    }
    setInterestName("");
  }
  const requests = snapshot.project.vacations.filter((vacation) => vacation.residentId === resident.id);
  const tabs = [
    ["profile", "Profile"],
    ["career", "Career"],
    ["vacation", "Vacation"],
    ["record", "Record"],
  ] as const;
  return (
    <div className="grid gap-2">
      <div className="flex gap-1">
        {tabs.map(([id, label]) => (
          <button key={id} className={`h-7 px-2 text-[13px] ${tab === id ? "border-b-2 border-navy font-semibold text-navy" : "text-muted"}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "profile" ? (
        <div className="grid gap-2 md:grid-cols-2">
          <Field label="Resident Name"><TextInput value={resident.name} onChange={(event) => set({ name: event.target.value })} /></Field>
          <Field label="ID"><TextInput className="font-mono" value={resident.id} onChange={(event) => set({ id: event.target.value })} /></Field>
          <Field label="PGY"><NumberInput value={resident.pgy} onChange={(event) => set({ pgy: Number(event.target.value) || 1 })} /></Field>
          <Field label="Track"><TextInput value={resident.track} onChange={(event) => set({ track: event.target.value })} /></Field>
          <Field label="Start Date"><TextInput className="font-mono" type="date" value={resident.startDate} onChange={(event) => set({ startDate: event.target.value })} /></Field>
          <Field label="Graduation Date"><TextInput className="font-mono" type="date" value={resident.graduationDate} onChange={(event) => set({ graduationDate: event.target.value })} /></Field>
          <Field label="Restrictions"><TextInput value={resident.restrictions.join(", ")} onChange={(event) => set({ restrictions: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></Field>
          <Field label="Notes"><TextInput value={resident.notes} onChange={(event) => set({ notes: event.target.value })} /></Field>
          <label className="flex items-center gap-2 text-[14px] md:col-span-2">
            <input type="checkbox" checked={Boolean(resident.locked)} onChange={(event) => set({ locked: event.target.checked ? true : undefined })} />
            Lock this schedule
          </label>
          <p className="text-[13px] text-muted md:col-span-2">Generation keeps every assigned block for this resident. Other residents stay free.</p>
        </div>
      ) : null}
      {tab === "career" ? (
        <div className="grid gap-2">
          <div className="flex items-end gap-2">
            <Field label="Career interest">
              <TextInput
                value={interestName}
                placeholder="Cardiology, orthopedic surgery, radiology"
                onChange={(event) => setInterestName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addCareerInterest();
                }}
              />
            </Field>
            <Button type="button" variant="quiet" disabled={!interestName.trim()} onClick={addCareerInterest}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {interests.map((interest) => {
              const ranked = resident.careerInterests.find((item) => item.interestId === interest.id);
              return (
                <button
                  key={interest.id}
                  type="button"
                  className={ranked ? "h-6 border border-navy bg-navy px-1.5 font-mono text-[11px] text-white" : "h-6 border border-line px-1.5 text-[12px]"}
                  onClick={() => {
                    const exists = resident.careerInterests.some((entry) => entry.interestId === interest.id);
                    const careerInterests = exists
                      ? resident.careerInterests.filter((entry) => entry.interestId !== interest.id).map((entry, index) => ({ ...entry, rank: index + 1 }))
                      : [...resident.careerInterests, { interestId: interest.id, rank: resident.careerInterests.length + 1 }];
                    set({ careerInterests });
                  }}
                >
                  {ranked ? `${ranked.rank} ${interest.name}` : interest.name}
                </button>
              );
            })}
          </div>
          {resident.careerInterests.map((item) => {
            const name = interests.find((interest) => interest.id === item.interestId)?.name ?? item.interestId;
            const matches = matchingRotationNames(item.interestId, name, snapshot.project.rotations);
            const shown = matches.slice(0, 12);
            const extra = matches.length - shown.length;
            return (
              <p key={item.interestId} className="text-[13px]">
                <span className="font-semibold">{name}.</span>{" "}
                {matches.length ? `Matches ${shown.join(", ")}${extra ? `, and ${extra} more` : ""}.` : "No rotation name matches this interest."}
              </p>
            );
          })}
          <Field label="Elective Rank">
            <TextInput value={resident.electivePreferences.map((item) => `${item.rotationId}:${item.rank}`).join("; ")} onChange={(event) => set({ electivePreferences: pairs(event.target.value).map(([rotationId, rank]) => ({ rotationId, rank: Number(rank) || 1 })) })} />
          </Field>
        </div>
      ) : null}
      {tab === "vacation" ? (
        <div className="grid gap-2">
          <table className="data-table w-full border border-line text-left text-[14px]">
            <thead className="bg-head"><tr><th className="px-1 py-1">Block</th><th>Priority</th><th>Status</th><th>Alternatives</th><th></th></tr></thead>
            <tbody>
              {requests.map((vacation) => (
                <tr key={vacation.id} className="border-t border-line">
                  <td className="px-1 py-1 font-mono">{vacation.blockId.toUpperCase()}</td>
                  <td className="font-mono">{vacation.rank}</td>
                  <td>
                    <Select value={vacation.status} onChange={(event) => updateVacation(vacation, { status: event.target.value === "approved" ? "approved" : "pending" })}>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                    </Select>
                  </td>
                  <td className="font-mono">{vacation.alternatives.join(", ")}</td>
                  <td><Button variant="quiet" onClick={() => updateProject((project) => ({ ...project, vacations: project.vacations.filter((item) => item.id !== vacation.id) }))}>Remove</Button></td>
                </tr>
              ))}
              {requests.length === 0 ? <tr><td className="px-1 py-1" colSpan={5}>No requests.</td></tr> : null}
            </tbody>
          </table>
          <AddVacation residentId={resident.id} />
        </div>
      ) : null}
      {tab === "record" ? (
        <div className="grid gap-2">
          <Field label="Previous Rotations"><TextInput value={resident.previousRotations.map((item) => `${item.rotationId}:${item.blocks}`).join("; ")} onChange={(event) => set({ previousRotations: pairs(event.target.value).map(([rotationId, blocks]) => ({ rotationId, blocks: Number(blocks) || 0 })) })} /></Field>
          <Field label="Locked Assignments"><TextInput value={resident.lockedAssignments.map((item) => `${item.blockId}:${item.rotationId}`).join("; ")} onChange={(event) => set({ lockedAssignments: pairs(event.target.value).map(([blockId, rotationId]) => ({ blockId, rotationId })) })} /></Field>
          <div className="grid grid-cols-4 gap-2">
            {(["icu", "nights", "wards", "holiday"] as const).map((key) => (
              <Field key={key} label={key.toUpperCase()}><NumberInput value={resident.historicalBurden[key]} onChange={(event) => set({ historicalBurden: { ...resident.historicalBurden, [key]: Number(event.target.value) || 0 } })} /></Field>
            ))}
          </div>
          {resident.waivers.length ? <p className="font-mono text-[12px]">Waivers {resident.waivers.map((waiver) => `${waiver.requirementId} ${waiver.amount}`).join(", ")}</p> : null}
        </div>
      ) : null}
      {tab !== "vacation" ? <Button onClick={() => onSave(interests)} disabled={!resident.name || !resident.id}>Save</Button> : null}
    </div>
  );

  function updateVacation(vacation: VacationRequest, patch: Partial<VacationRequest>) {
    updateProject((project) => ({ ...project, vacations: project.vacations.map((item) => item.id === vacation.id ? { ...item, ...patch } : item) }));
  }
}

function AddVacation({ residentId }: { residentId: string }) {
  const { snapshot, updateProject } = useApp();
  const [blockId, setBlockId] = useState(snapshot.project.blocks[0]?.id ?? "");
  const [rank, setRank] = useState(1);
  if (!snapshot.project.blocks.length) return null;
  return (
    <div className="flex flex-wrap items-end gap-1">
      <Field label="Block">
        <Select value={blockId} onChange={(event) => setBlockId(event.target.value)}>
          {snapshot.project.blocks.map((block) => <option key={block.id} value={block.id}>{block.id.toUpperCase()}</option>)}
        </Select>
      </Field>
      <Field label="Priority"><NumberInput className="w-16" value={rank} onChange={(event) => setRank(Number(event.target.value) || 1)} /></Field>
      <Button variant="quiet" onClick={() => updateProject((project) => ({ ...project, vacations: [...project.vacations, { id: newId("vac"), residentId, blockId, rank, status: "pending", alternatives: [] }] }))}>Add Request</Button>
    </div>
  );
}

export function RotationsSection() {
  const { snapshot, updateProject } = useApp();
  const [draft, setDraft] = useState<Rotation | null>(null);
  const project = snapshot.project;
  const groups = CATEGORIES
    .map((category) => ({ category, rotations: project.rotations.filter((rotation) => rotation.category === category) }))
    .filter((group) => group.rotations.length > 0);
  return (
    <div className="grid gap-4">
      <div>
        <Button onClick={() => setDraft(blankRotation(project.blocks.map((block) => block.id)))}>Add rotation</Button>
      </div>
      {project.rotations.length === 0 ? <p className="text-[13px]">No rotations configured.</p> : groups.map((group) => (
        <section key={group.category} className="border border-line bg-card">
          <h2 className="on-tint border-b border-line px-3 py-2 text-[14px] font-semibold" style={{ background: categoryBackground(group.category) }}>{CATEGORY_LABEL[group.category]}</h2>
          <ul>
            {group.rotations.map((rotation) => {
              const note = requirementNote(rotation, project);
              return (
              <li key={rotation.id} className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
                <div className="min-w-0">
                  <div className="font-semibold">{rotation.name}</div>
                  <div className="text-[13px] text-muted">{yearLabel(rotation.eligiblePgy)} · {rotation.durationBlocks} {rotation.durationBlocks === 1 ? "block" : "blocks"} · {staffingSummary(rotation)}</div>
                  {note ? <div className="text-[13px] text-muted">{note}</div> : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="quiet" onClick={() => setDraft(rotation)}>Edit</Button>
                  <Button variant="danger" onClick={() => updateProject((current) => ({
                    ...current,
                    rotations: current.rotations.filter((item) => item.id !== rotation.id),
                    requirements: current.requirements.map((item) => ({ ...item, rotationIds: item.rotationIds.filter((id) => id !== rotation.id) })),
                  }), `Removed ${rotation.name}`)}>Remove</Button>
                </div>
              </li>
              );
            })}
          </ul>
        </section>
      ))}
      <RotationRequirements />
      <Modal wide open={Boolean(draft)} title={draft?.name || "Rotation"} onClose={() => setDraft(null)}>
        {draft ? <RotationForm key={draft.id} rotation={draft} onChange={setDraft} onSave={() => { saveRotation(draft); setDraft(null); }} /> : null}
      </Modal>
    </div>
  );

  function saveRotation(rotation: Rotation) {
    updateProject((current) => ({
      ...current,
      rotations: current.rotations.some((item) => item.id === rotation.id)
        ? current.rotations.map((item) => (item.id === rotation.id ? rotation : item))
        : [...current.rotations, rotation],
    }), `Saved rotation ${rotation.name}`);
  }
}

interface BlockDraft {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  holiday: boolean;
  locked: boolean;
  vacation: number;
}

export function BlocksSection() {
  const { snapshot, updateProject } = useApp();
  const project = snapshot.project;
  const [draft, setDraft] = useState<BlockDraft | null>(null);
  const open = (block: Block) => setDraft({
    id: block.id,
    label: block.label,
    startDate: block.startDate,
    endDate: block.endDate,
    holiday: block.holiday,
    locked: Boolean(block.locked),
    vacation: vacationCapacity(project, block.id),
  });
  return (
    <div className="grid gap-4">
      <section className="border border-line bg-card">
        <div className="grid gap-2 px-3 py-3 md:grid-cols-[180px_1fr] md:items-end">
          <Field label="Default vacation capacity">
            <NumberInput min={0} value={project.vacationRules.defaultCapacity} onChange={(event) => updateProject((current) => ({ ...current, vacationRules: { ...current.vacationRules, defaultCapacity: Math.max(0, Number(event.target.value) || 0) } }))} />
          </Field>
          <p className="text-[13px] text-muted">A block uses this number unless its own vacation capacity differs. 0 means vacation is blocked that week.</p>
        </div>
      </section>
      {project.blocks.length === 0 ? <p className="text-[13px]">No blocks yet.</p> : (
        <ul className="border border-line bg-card">
          {project.blocks.map((block) => (
            <li key={block.id} className="border-t border-line first:border-t-0">
              <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-head" onClick={() => open(block)}>
                <span className="min-w-0">
                  <span className="block font-semibold">{block.label}</span>
                  <span className="block text-[13px] text-muted">{blockDetail(project, block)}</span>
                </span>
                <span className="shrink-0 text-[13px] font-semibold text-navy">Edit</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={Boolean(draft)} title={draft?.label || "Block"} onClose={() => setDraft(null)}>
        {draft ? (
          <div className="grid gap-3">
            <Field label="Name"><TextInput value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Start"><TextInput className="font-mono" type="date" value={draft.startDate} onChange={(event) => { if (event.target.value) setDraft({ ...draft, startDate: event.target.value }); }} /></Field>
              <Field label="End"><TextInput className="font-mono" type="date" value={draft.endDate} onChange={(event) => { if (event.target.value) setDraft({ ...draft, endDate: event.target.value }); }} /></Field>
            </div>
            <p className="text-[13px] text-muted">Changing a date moves the shared edge of the neighboring block. Each block keeps at least one day.</p>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={draft.holiday} onChange={(event) => setDraft({ ...draft, holiday: event.target.checked })} />
              Holiday
            </label>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={draft.locked} onChange={(event) => setDraft({ ...draft, locked: event.target.checked })} />
              Locked
            </label>
            <p className="text-[13px] text-muted">A locked block keeps every assigned resident on the current rotation. Individual tiles can still be locked on their own.</p>
            <Field label="Vacation capacity">
              <NumberInput min={0} value={draft.vacation} onChange={(event) => setDraft({ ...draft, vacation: Math.max(0, Number(event.target.value) || 0) })} />
            </Field>
            <div>
              <Button onClick={() => { saveBlock(draft); setDraft(null); }} disabled={!draft.label.trim() || !draft.startDate || !draft.endDate}>Save block</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );

  function saveBlock(next: BlockDraft) {
    updateProject((current) => {
      let blocks = current.blocks.map((item) => item.id === next.id ? { ...item, label: next.label.trim(), holiday: next.holiday, locked: next.locked } : item);
      const original = current.blocks.find((item) => item.id === next.id);
      if (original && next.startDate !== original.startDate) blocks = editBlockDate(blocks, next.id, "startDate", next.startDate);
      const moved = blocks.find((item) => item.id === next.id);
      if (moved && next.endDate !== moved.endDate) blocks = editBlockDate(blocks, next.id, "endDate", next.endDate);
      return withBlockVacation({ ...current, blocks }, next.id, next.vacation);
    }, `Saved block ${next.label.trim()}`);
  }
}

function blockDetail(project: Project, block: Block): string {
  const generated = blockRangeLabel(block.startDate, block.endDate);
  const named = block.label !== generated && block.label !== `${generated} ${block.startDate.slice(0, 4)}`;
  const parts = [
    named ? `${formatDay(block.startDate)} – ${formatDay(block.endDate)}` : null,
    block.holiday ? "Holiday" : null,
    block.locked ? "Locked" : null,
    `Vacation ${vacationCapacity(project, block.id)}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

function blankRotation(blockIds: string[]): Rotation {
  return {
    id: newId("rot"),
    name: "",
    category: "elective",
    durationBlocks: 1,
    eligiblePgy: [1, 2, 3, 4, 5, 6, 7, 8],
    eligibleTracks: [],
    staffing: blockIds.map((blockId) => ({ blockId, min: 0, max: 1 })),
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
    color: "#355c8a",
  };
}

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

function EligibleYears({ years, onChange }: { years: number[]; onChange: (years: number[]) => void }) {
  const selected = selectedYears(years);
  const [individual, setIndividual] = useState(() => selected.length > 0 && !yearsAreContiguous(selected));
  const from = selected.length ? selected[0] : null;
  const through = selected.length ? selected[selected.length - 1] : null;
  const chooseRange = (nextFrom: number, nextThrough: number) => onChange(fillYears(nextFrom, nextThrough));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="text-[13px] font-semibold text-ink">Eligible years</div>
        <button type="button" className="text-[13px] font-semibold text-navy" onClick={() => {
          if (individual && selected.length && !yearsAreContiguous(selected)) onChange(fillYears(selected[0], selected[selected.length - 1]));
          setIndividual((current) => !current);
        }}>
          {individual ? "Use a range" : "Choose individual years"}
        </button>
      </div>
      {individual ? (
        <div className="flex flex-wrap gap-1">
          {PGY_LEVELS.map((level) => {
            const on = selected.includes(level);
            return (
              <button
                key={level}
                type="button"
                aria-pressed={on}
                aria-label={`PGY-${level}`}
                className={on ? "h-8 min-w-8 border border-navy bg-navy px-2 font-mono text-[13px] text-white" : "h-8 min-w-8 border border-line bg-card px-2 font-mono text-[13px] text-ink"}
                onClick={() => onChange(on ? selected.filter((item) => item !== level) : [...selected, level].sort((left, right) => left - right))}
              >
                {level}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Eligible from" className="w-28" value={from ?? ""} onChange={(event) => {
            if (!event.target.value) {
              onChange([]);
              return;
            }
            const next = Number(event.target.value);
            chooseRange(next, through == null ? next : Math.max(next, through));
          }}>
            <option value="">None</option>
            {PGY_LEVELS.map((level) => <option key={level} value={level}>PGY-{level}</option>)}
          </Select>
          <span className="text-[14px] text-muted">through</span>
          <Select aria-label="Eligible through" className="w-28" value={through ?? ""} disabled={from == null} onChange={(event) => {
            const next = Number(event.target.value);
            if (!next || from == null) return;
            chooseRange(Math.min(from, next), next);
          }}>
            {PGY_LEVELS.map((level) => <option key={level} value={level}>PGY-{level}</option>)}
          </Select>
          {selected.length === 0 || selected.length >= 8 ? <span className="text-[13px] text-muted">{yearLabel(selected)}</span> : null}
        </div>
      )}
    </div>
  );
}

function RotationForm({ rotation, onChange, onSave }: { rotation: Rotation; onChange: (rotation: Rotation) => void; onSave: () => void }) {
  const { snapshot } = useApp();
  const [prerequisiteId, setPrerequisiteId] = useState("");
  const [prerequisiteBlocks, setPrerequisiteBlocks] = useState(1);
  const [interestId, setInterestId] = useState("");
  const [relevance, setRelevance] = useState(100);
  const set = (patch: Partial<Rotation>) => onChange({ ...rotation, ...patch });
  const wholeYear = rotation.availableBlocks.length === 0;
  const color = /^#[0-9a-fA-F]{6}$/.test(rotation.color) ? rotation.color : "#355c8a";
  const notableStaffing = rotation.staffing.some((cell) => cell.min > 0 || cell.max !== 1);
  const extras = [
    rotation.eligibleTracks.length ? "Tracks" : "",
    notableStaffing ? "Staffing" : "",
    rotation.prerequisites.length ? "Prerequisites" : "",
    rotation.careerRelevance.length ? "Career relevance" : "",
    rotation.availableBlocks.length ? "Limited weeks" : "",
    rotation.maxConsecutive != null || rotation.maxBlocksPerResident != null ? "Caps" : "",
    rotation.relaxStaffingMin !== 0 || rotation.relaxStaffingMax !== 0 || rotation.staffingPriority !== 1 ? "Staffing rules" : "",
  ].filter(Boolean);
  const setStaffing = (blockId: string, minText: string, maxText: string) => {
    const rest = rotation.staffing.filter((cell) => cell.blockId !== blockId);
    if (minText === "" && maxText === "") {
      set({ staffing: rest });
      return;
    }
    const min = minText === "" ? 0 : Number(minText) || 0;
    const max = maxText === "" ? Math.max(min, snapshot.project.residents.length) : Number(maxText) || 0;
    set({ staffing: [...rest, { blockId, min, max }] });
  };
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Name"><TextInput value={rotation.name} onChange={(event) => set({ name: event.target.value })} /></Field>
        <Field label="Category">
          <Select value={rotation.category} onChange={(event) => set({ category: event.target.value as RotationCategory })}>
            {CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABEL[category]}</option>)}
          </Select>
        </Field>
        <Field label="Duration in blocks"><NumberInput value={rotation.durationBlocks} onChange={(event) => set({ durationBlocks: Number(event.target.value) || 1 })} /></Field>
      </div>
      <EligibleYears years={rotation.eligiblePgy} onChange={(eligiblePgy) => set({ eligiblePgy })} />
      <MoreOptions initiallyOpen={extras.length > 0} hint={extras.join(" · ")}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Workload intensity"><NumberInput value={rotation.workloadIntensity} onChange={(event) => set({ workloadIntensity: Number(event.target.value) || 1 })} /></Field>
          <Field label="Color"><input type="color" className="h-8 w-16 border border-line bg-white" value={color} onChange={(event) => set({ color: event.target.value })} /></Field>
          <Field label="Max consecutive"><NumberInput value={rotation.maxConsecutive ?? ""} onChange={(event) => set({ maxConsecutive: event.target.value === "" ? null : Number(event.target.value) })} /></Field>
          <Field label="Max blocks per resident"><NumberInput value={rotation.maxBlocksPerResident ?? ""} onChange={(event) => set({ maxBlocksPerResident: event.target.value === "" ? null : Number(event.target.value) })} /></Field>
          <Field label="Staffing priority (0 is immutable)"><NumberInput value={rotation.staffingPriority} onChange={(event) => set({ staffingPriority: Number(event.target.value) || 0 })} /></Field>
          <Field label="Authorized minimum reduction"><NumberInput value={rotation.relaxStaffingMin} onChange={(event) => set({ relaxStaffingMin: Number(event.target.value) || 0 })} /></Field>
          <Field label="Authorized maximum increase"><NumberInput value={rotation.relaxStaffingMax} onChange={(event) => set({ relaxStaffingMax: Number(event.target.value) || 0 })} /></Field>
        </div>
        <Field label="Eligible tracks (blank means every track)"><TextInput value={rotation.eligibleTracks.join(", ")} onChange={(event) => set({ eligibleTracks: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></Field>
        <div className="grid gap-2">
          <div className="text-[13px] font-semibold">Staffing</div>
          <p className="text-[13px] text-muted">Leave a block blank when it has no set limit.</p>
          <div className="max-h-64 overflow-auto border border-line">
            <table className="data-table w-full text-left text-[13px]">
              <thead className="bg-head">
                <tr>
                  <th>Block</th>
                  <th>Dates</th>
                  <th>Minimum</th>
                  <th>Maximum</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.project.blocks.map((block) => {
                  const cell = rotation.staffing.find((item) => item.blockId === block.id);
                  return (
                    <tr key={block.id} className="border-t border-line">
                      <td className="font-semibold">{block.label}</td>
                      <td className="font-mono">{formatDay(block.startDate)} – {formatDay(block.endDate)}</td>
                      <td><NumberInput aria-label={`${rotation.name || "Rotation"} ${block.label} minimum`} className="w-20" value={cell ? cell.min : ""} onChange={(event) => setStaffing(block.id, event.target.value, cell ? String(cell.max) : "")} /></td>
                      <td><NumberInput aria-label={`${rotation.name || "Rotation"} ${block.label} maximum`} className="w-20" value={cell ? cell.max : ""} onChange={(event) => setStaffing(block.id, cell ? String(cell.min) : "", event.target.value)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="grid gap-2">
          <div className="text-[13px] font-semibold">Prerequisites</div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Rotation">
              <Select value={prerequisiteId} onChange={(event) => setPrerequisiteId(event.target.value)}>
                <option value="">Choose a rotation</option>
                {snapshot.project.rotations.filter((item) => item.id !== rotation.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </Field>
            <Field label="Blocks"><NumberInput className="w-20" value={prerequisiteBlocks} onChange={(event) => setPrerequisiteBlocks(Number(event.target.value) || 0)} /></Field>
            <Button variant="quiet" type="button" disabled={!prerequisiteId} onClick={() => set({ prerequisites: [...rotation.prerequisites.filter((item) => item.rotationId !== prerequisiteId), { rotationId: prerequisiteId, blocks: prerequisiteBlocks }] })}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {rotation.prerequisites.map((item) => (
              <button key={item.rotationId} type="button" className="h-7 border border-line bg-head px-2 text-[13px]" onClick={() => set({ prerequisites: rotation.prerequisites.filter((entry) => entry.rotationId !== item.rotationId) })}>
                {snapshot.project.rotations.find((entry) => entry.id === item.rotationId)?.name ?? item.rotationId} · {item.blocks}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-2">
          <div className="text-[13px] font-semibold">Career relevance</div>
          <p className="text-[13px]">Interests match this rotation by name. A score here replaces that match.</p>
          {snapshot.project.interests.length ? (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Interest">
                  <Select value={interestId} onChange={(event) => setInterestId(event.target.value)}>
                    <option value="">Choose an interest</option>
                    {snapshot.project.interests.map((interest) => <option key={interest.id} value={interest.id}>{interest.name}</option>)}
                  </Select>
                </Field>
                <Field label="Score"><NumberInput className="w-20" value={relevance} onChange={(event) => setRelevance(Number(event.target.value) || 0)} /></Field>
                <Button variant="quiet" type="button" disabled={!interestId} onClick={() => set({ careerRelevance: [...rotation.careerRelevance.filter((item) => item.interestId !== interestId), { interestId, score: relevance }] })}>Add</Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {rotation.careerRelevance.map((item) => (
                  <button key={item.interestId} type="button" className="h-7 border border-line bg-head px-2 text-[13px]" onClick={() => set({ careerRelevance: rotation.careerRelevance.filter((entry) => entry.interestId !== item.interestId) })}>
                    {snapshot.project.interests.find((interest) => interest.id === item.interestId)?.name ?? item.interestId} · {item.score}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={wholeYear} onChange={(event) => set({ availableBlocks: event.target.checked ? [] : snapshot.project.blocks.map((block) => block.id) })} /> Available the whole year</label>
        {wholeYear ? null : (
          <div className="flex flex-wrap gap-2">
            {snapshot.project.blocks.map((block) => (
              <label key={block.id} className="flex items-center gap-1 text-[13px]">
                <input type="checkbox" checked={rotation.availableBlocks.includes(block.id)} onChange={(event) => set({ availableBlocks: event.target.checked ? [...rotation.availableBlocks, block.id] : rotation.availableBlocks.filter((id) => id !== block.id) })} />
                {block.label}
              </label>
            ))}
          </div>
        )}
      </MoreOptions>
      <Button onClick={onSave} disabled={!rotation.name || !rotation.id}>Save rotation</Button>
    </div>
  );
}
