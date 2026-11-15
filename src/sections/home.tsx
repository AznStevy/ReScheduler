import { STORAGE_WARNING } from "@/domain/types";
import { residentProgress } from "@/domain/progress";
import { measureSchedule } from "@/solver/metrics";
import { useApp } from "@/state/store";
import { BlockCalendar, blockOn } from "@/ui/block-calendar";
import { Button, Field, NumberInput, Select } from "@/ui/kit";
import { applyTheme, colorsOf, loadTheme, saveTheme, SCHEMES, subscribeTheme, type CustomColors, type ThemeChoice } from "@/ui/theme";
import { download } from "@/lib/cn";
import { exportIcs, exportProjectJson, exportResidentsCsv, exportScheduleCsv, exportWorkbook, importCsv, importPdfSchedule, importProjectJson, importWorkbook } from "@/io/transfer";
import { useEffect, useMemo, useState } from "react";

const EXPORT_ORDER = ["xlsx", "json", "schedule", "residents", "ics"] as const;
type ExportFormat = (typeof EXPORT_ORDER)[number];

const EXPORTS: Record<ExportFormat, { label: string; note: string; filename: string; type: string }> = {
  xlsx: {
    label: "Excel workbook",
    note: "The full program: schedule, rules, settings, history, and color scheme.",
    filename: "rescheduler.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  json: {
    label: "Project file",
    note: "The full program, including settings, history, and the color scheme.",
    filename: "rescheduler-project.json",
    type: "application/json",
  },
  schedule: {
    label: "Schedule CSV",
    note: "The current grid as a spreadsheet.",
    filename: "schedule.csv",
    type: "text/csv",
  },
  residents: {
    label: "Residents CSV",
    note: "The resident list.",
    filename: "residents.csv",
    type: "text/csv",
  },
  ics: {
    label: "Calendar",
    note: "Assignments as a calendar file.",
    filename: "schedule.ics",
    type: "text/calendar",
  },
};

const SAMPLES = [
  { kind: "demo", name: "Sample program", note: "A full year with residents, rotations, and requirements." },
  { kind: "conflict", name: "Coverage Conflict", note: "Staffing that generation can relax." },
  { kind: "immutable", name: "Infeasible Staffing", note: "A conflict generation cannot satisfy." },
  { kind: "empty", name: "Empty Program", note: "A blank year." },
] as const;

export function DashboardSection() {
  const { snapshot, result, optimizing, setSection } = useApp();
  const { project } = snapshot;
  const metrics = useMemo(() => (project.assignments.length ? measureSchedule(project, project.assignments) : null), [project]);
  const cells = project.residents.length * project.blocks.length;
  const assigned = project.assignments.length;
  const gaps = metrics?.staffingShortfalls.length ?? 0;
  const deficits = project.residents.filter((resident) => residentProgress(project, resident).some((item) => item.mustScheduleNow > item.scheduled)).length;
  const pending = project.vacations.filter((vacation) => vacation.status === "pending").length;
  const [selectedBlock, setSelectedBlock] = useState<string | null>(blockOn(project.blocks, project.asOfDate)?.id ?? project.blocks[0]?.id ?? null);
  const status = optimizing ? "Generating" : result?.cancelled ? "Cancelled" : result?.feasible ? (result.proposals.some((item) => item.provenOptimal && item.validation.ok) ? "Optimal" : "Feasible") : result?.provedInfeasible ? "Infeasible" : assigned ? "Draft" : "Not Generated";
  const tiles = [
    ["Residents", String(project.residents.length)],
    ["Assigned Blocks", String(assigned)],
    ["Unassigned Blocks", String(Math.max(0, cells - assigned))],
    ["Coverage Gaps", metrics ? String(gaps) : "—"],
    ["Requirement Deficits", String(deficits)],
    ["Pending Vacation", String(pending)],
    ["Schedule Status", status],
  ];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {tiles.map(([label, value]) => {
            const body = (
              <>
                <div className="text-[12px] leading-tight text-muted">{label}</div>
                <div className="font-mono text-[20px] leading-none text-navy">{value}</div>
              </>
            );
            return label === "Coverage Gaps" ? (
              <button key={label} type="button" onClick={() => setSection("conflicts")} className="flex min-h-[76px] flex-col justify-between border border-line bg-card px-3 py-2 text-left hover:border-steel">
                {body}
              </button>
            ) : (
              <div key={label} className="flex min-h-[76px] flex-col justify-between border border-line bg-card px-3 py-2">
                {body}
              </div>
            );
          })}
        </div>
      </div>
      <BlockCalendar project={project} selectedId={selectedBlock} onSelect={setSelectedBlock} />
    </div>
  );
}

export function TransferSection() {
  const { snapshot, replaceSnapshot, setNotice } = useApp();
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const chosen = EXPORTS[format];

  async function ingest(file: File) {
    const name = file.name.toLowerCase();
    const result = name.endsWith(".json")
      ? importProjectJson(await file.text())
      : name.endsWith(".csv")
        ? importCsv(await file.text(), snapshot)
        : name.endsWith(".pdf")
          ? await importPdfSchedule(await file.arrayBuffer(), file.name)
          : importWorkbook(await file.arrayBuffer(), file.name);
    setErrors(result.errors);
    setWarnings(result.warnings);
    if (!result.snapshot) {
      setNotice(result.errors[0] ?? "Unable to load schedule file.");
      return;
    }
    if (result.theme) {
      saveTheme(result.theme);
      applyTheme(result.theme);
    }
    replaceSnapshot(result.snapshot, `Imported ${file.name}`);
    setNotice(result.warnings[0] ?? `Imported ${file.name}.`);
  }

  function exported(): BlobPart {
    const theme = loadTheme();
    if (format === "json") return exportProjectJson(snapshot, theme);
    if (format === "schedule") return exportScheduleCsv(snapshot.project);
    if (format === "residents") return exportResidentsCsv(snapshot.project);
    if (format === "ics") return exportIcs(snapshot.project);
    return exportWorkbook(snapshot, theme);
  }

  return (
    <div className="grid gap-3">
      <section className="border border-line bg-card">
        <h2 className="border-b border-line bg-head px-3 py-2 text-[14px] font-semibold">Export</h2>
        <div className="grid gap-2 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Format">
              <Select value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)}>
                {EXPORT_ORDER.map((id) => <option key={id} value={id}>{EXPORTS[id].label}</option>)}
              </Select>
            </Field>
            <Button onClick={() => download(chosen.filename, exported(), chosen.type)}>Export</Button>
          </div>
          <p className="text-[13px] text-muted">{chosen.note}</p>
        </div>
      </section>
      <section className="border border-line bg-card">
        <h2 className="border-b border-line bg-head px-3 py-2 text-[14px] font-semibold">Import</h2>
        <div className="grid gap-2 p-3">
          <p className="text-[13px] text-muted">JSON, Excel, CSV, PDF, or a QGenda staff grid. The file replaces the program currently open.</p>
          <label className="inline-flex h-8 w-fit cursor-pointer items-center rounded-sm border border-line bg-card px-3 text-[14px] font-semibold">
            Choose file
            <input className="hidden" type="file" accept=".json,.xlsx,.xls,.csv,.pdf,application/json,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void ingest(file); event.target.value = ""; }} />
          </label>
          {errors.length ? <ul className="text-[13px] text-bad">{errors.map((error) => <li key={error}>{error}</li>)}</ul> : null}
          {warnings.length ? <ul className="text-[13px] text-muted">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
        </div>
      </section>
    </div>
  );
}

export function SettingsSection() {
  const { snapshot, updateSettings, loadScenario, clearStorage } = useApp();
  const settings = snapshot.settings;

  return (
    <div className="grid gap-3">
      <section className="border border-line bg-card">
        <h2 className="border-b border-line bg-head px-3 py-2 text-[14px] font-semibold">Generation</h2>
        <div className="grid gap-3 p-3 md:grid-cols-[180px_1fr]">
          <Field label="Time Limit (sec)">
            <NumberInput min={1} max={120} value={settings.timeLimitSeconds} onChange={(event) => updateSettings({ ...settings, timeLimitSeconds: Number(event.target.value) || 1 })} />
          </Field>
          <div className="grid content-end gap-2 text-[14px]">
            <p className="text-[13px] leading-5 text-muted">Generation searches several different schedules inside this time limit. Each one can be previewed before it is applied.</p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={settings.randomSeed != null} onChange={(event) => updateSettings({ ...settings, randomSeed: event.target.checked ? 1 : null })} />
              Repeat the same result
            </label>
          </div>
        </div>
        <details className="border-t border-line px-3 py-2 text-[13px]">
          <summary className="cursor-pointer font-semibold">Advanced</summary>
          <div className="mt-2 max-w-xs">
            <Field label="Optimality gap">
              <NumberInput min={0} step="0.01" value={settings.mipRelGap} onChange={(event) => updateSettings({ ...settings, mipRelGap: Number(event.target.value) || 0 })} />
            </Field>
            <p className="mt-1 text-muted">0 waits until the best schedule is proved. A larger gap can stop earlier.</p>
          </div>
        </details>
      </section>
      <ColorSchemeSection />
      <section className="border border-line bg-card">
        <h2 className="border-b border-line bg-head px-3 py-2 text-[14px] font-semibold">Sample programs</h2>
        <p className="px-3 pt-3 text-[13px] text-muted">Loading a sample replaces the program on this computer.</p>
        <ul>
          {SAMPLES.map((sample) => (
            <li key={sample.kind} className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
              <div>
                <div className="font-semibold">{sample.name}</div>
                <div className="text-[13px] text-muted">{sample.note}</div>
              </div>
              <Button variant="quiet" aria-label={sample.name} onClick={() => confirmLoad(() => loadScenario(sample.kind))}>Load</Button>
            </li>
          ))}
        </ul>
      </section>
      <section className="border border-line bg-card">
        <h2 className="border-b border-line bg-head px-2 py-1 text-[14px] font-semibold">Local Storage</h2>
        <p className="px-2 py-1 text-[13px] leading-5">{STORAGE_WARNING}</p>
        <div className="px-2 pb-2">
          <Button variant="danger" onClick={() => { if (window.confirm("Clear the saved program from this browser?")) void clearStorage(); }}>Clear Local Storage</Button>
        </div>
      </section>
    </div>
  );
}

const CUSTOM_FIELDS: Array<{ key: keyof CustomColors; label: string }> = [
  { key: "sidebar", label: "Sidebar" },
  { key: "steel", label: "Accent" },
  { key: "paper", label: "Background" },
  { key: "card", label: "Surface" },
  { key: "ink", label: "Text" },
];

function ColorSchemeSection() {
  const [choice, setChoice] = useState<ThemeChoice>(() => loadTheme());
  const custom = choice.custom ?? colorsOf(choice.id === "custom" ? "clinical" : choice.id);
  useEffect(() => subscribeTheme(setChoice), []);
  function choose(next: ThemeChoice) {
    setChoice(next);
    saveTheme(next);
    applyTheme(next);
  }
  return (
    <section className="border border-line bg-card">
      <h2 className="border-b border-line bg-head px-3 py-2 text-[14px] font-semibold">Color scheme</h2>
      <div className="grid gap-3 p-3">
        <div className="flex flex-wrap gap-2">
          {SCHEMES.map((scheme) => (
            <button
              key={scheme.id}
              type="button"
              aria-pressed={choice.id === scheme.id}
              onClick={() => choose({ id: scheme.id })}
              className={`flex items-center gap-2 border px-2 py-1.5 text-left text-[14px] ${choice.id === scheme.id ? "border-navy font-semibold" : "border-line"}`}
            >
              <SchemeSwatch sidebar={scheme.sidebar} steel={scheme.steel} paper={scheme.paper} />
              {scheme.name}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={choice.id === "custom"}
            onClick={() => choose({ id: "custom", custom })}
            className={`flex items-center gap-2 border px-2 py-1.5 text-left text-[14px] ${choice.id === "custom" ? "border-navy font-semibold" : "border-line"}`}
          >
            <SchemeSwatch sidebar={custom.sidebar} steel={custom.steel} paper={custom.paper} />
            Custom
          </button>
        </div>
        {choice.id === "custom" ? (
          <div className="flex flex-wrap gap-3">
            {CUSTOM_FIELDS.map((field) => (
              <label key={field.key} className="grid gap-1 text-[13px] font-semibold text-ink">
                {field.label}
                <input
                  type="color"
                  aria-label={field.label}
                  value={custom[field.key]}
                  className="h-8 w-16 border border-line bg-card"
                  onChange={(event) => choose({ id: "custom", custom: { ...custom, [field.key]: event.target.value } })}
                />
              </label>
            ))}
          </div>
        ) : null}
        <p className="text-[13px] text-muted">Saved in this browser.</p>
      </div>
    </section>
  );
}

function SchemeSwatch({ sidebar, steel, paper }: { sidebar: string; steel: string; paper: string }) {
  return (
    <span className="grid h-7 w-7 grid-rows-[12px_1fr] overflow-hidden rounded-sm border border-line" style={{ background: paper }} aria-hidden>
      <span style={{ background: sidebar }} />
      <span className="mx-1 mt-1 h-1" style={{ background: steel }} />
    </span>
  );
}

function confirmLoad(load: () => void) {
  if (window.confirm("Replace the current program?")) load();
}
