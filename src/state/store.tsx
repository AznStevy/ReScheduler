import { clearSnapshot, loadSnapshot, saveSnapshot } from "@/db/database";
import {
  buildEmptyProject,
  buildImmutableConflict,
  buildInternalMedicineDemo,
  buildResolvableConflict,
  snapshotOf,
} from "@/data/scenarios";
import { newId } from "@/lib/cn";
import type { Assignment, AuditEntry, OptimizationSettings, OptimizeResult, Project, Proposal, Snapshot } from "@/domain/types";
import { topSolutions } from "@/solver/solutions";
import { createOptimizer } from "@/worker/client";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export const SECTIONS = [
  ["home", "Overview"],
  ["dashboard", "Dashboard"],
  ["residents", "Residents"],
  ["rotations", "Rotations"],
  ["blocks", "Blocks"],
  ["schedule", "Schedule"],
  ["optimize", "Generation"],
  ["conflicts", "Conflicts"],
  ["transfer", "Import / Export"],
  ["settings", "Settings"],
] as const;

export type SectionId = (typeof SECTIONS)[number][0];

function parseSection(hash: string): SectionId {
  const id = hash.replace(/^#/, "");
  if (id === "" || id === "home" || id === "overview") return "home";
  if (id === "requirements") return "rotations";
  if (id === "vacation" || id === "career") return "residents";
  return SECTIONS.some((item) => item[0] === id) ? (id as SectionId) : "dashboard";
}

interface HistoryState {
  undo: Assignment[][];
  redo: Assignment[][];
}

interface AppValue {
  hydrated: boolean;
  solver: "loading" | "ready" | "failed";
  solverDetail: string;
  section: SectionId;
  snapshot: Snapshot;
  selected: string[];
  optimizing: boolean;
  progress: string;
  elapsed: number;
  result: OptimizeResult | null;
  notice: string | null;
  canUndo: boolean;
  canRedo: boolean;
  setSection: (section: SectionId) => void;
  setNotice: (notice: string | null) => void;
  updateProject: (recipe: (project: Project) => Project, audit?: string) => void;
  replaceSnapshot: (snapshot: Snapshot, detail: string) => void;
  updateSettings: (settings: OptimizationSettings) => void;
  toggleSelected: (id: string) => void;
  setSelected: (ids: string[]) => void;
  setAssignments: (assignments: Assignment[]) => void;
  undo: () => void;
  redo: () => void;
  generate: () => void;
  stop: () => void;
  applyProposal: (proposal: Proposal) => void;
  rejectProposal: (proposal: Proposal) => void;
  loadScenario: (kind: "demo" | "conflict" | "immutable" | "empty") => void;
  clearStorage: () => Promise<void>;
}

function withProposal(current: Snapshot, proposal: Proposal): Snapshot {
  const residents = current.project.residents.map((resident) => {
    const grants = proposal.relaxations.filter((item) => item.kind === "requirement" && item.residentId === resident.id);
    if (!grants.length) return resident;
    return {
      ...resident,
      waivers: [
        ...resident.waivers,
        ...grants
          .filter((grant) => !resident.waivers.some((waiver) => waiver.requirementId === (grant.requirementId ?? "") && waiver.amount === grant.amount && waiver.reason === grant.description))
          .map((grant) => ({
            id: newId("waiver"),
            requirementId: grant.requirementId ?? "",
            amount: grant.amount,
            reason: grant.description,
            grantedAt: new Date().toISOString(),
          })),
      ],
    };
  });
  const staffingWaivers = [
    ...current.project.staffingWaivers,
    ...proposal.relaxations
      .filter((item) => item.kind !== "requirement")
      .filter((item) => !current.project.staffingWaivers.some((waiver) => waiver.blockId === (item.blockId ?? "") && waiver.rotationId === (item.rotationId ?? "") && waiver.reason === item.description))
      .map((item) => ({
        id: newId("staff"),
        blockId: item.blockId ?? "",
        rotationId: item.rotationId ?? "",
        minReduction: item.kind === "staffing-min" ? item.amount : 0,
        maxIncrease: item.kind === "staffing-max" ? item.amount : 0,
        reason: item.description,
        grantedAt: new Date().toISOString(),
      })),
  ];
  const version = {
    id: newId("version"),
    name: proposal.title,
    createdAt: new Date().toISOString(),
    assignments: current.project.assignments,
    note: proposal.summary,
  };
  return {
    ...current,
    versions: [version, ...current.versions].slice(0, 20),
    project: {
      ...current.project,
      residents,
      staffingWaivers,
      assignments: proposal.assignments.map((item) => {
        const duties = current.project.assignments.find((assignment) => assignment.residentId === item.residentId && assignment.blockId === item.blockId)?.duties;
        return { ...item, source: "optimizer" as const, ...(duties?.length ? { duties } : {}) };
      }),
    },
  };
}

const AppContext = createContext<AppValue | null>(null);

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside the app provider");
  return value;
}

function withAudit(snapshot: Snapshot, action: string, detail: string): Snapshot {
  const entry: AuditEntry = { id: newId("audit"), at: new Date().toISOString(), action, detail };
  return { ...snapshot, audit: [...snapshot.audit, entry].slice(-200) };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => snapshotOf(buildInternalMedicineDemo()));
  const [hydrated, setHydrated] = useState(false);
  const [section, setSectionState] = useState<SectionId>(() => parseSection(window.location.hash));
  const [selected, setSelected] = useState<string[]>([]);
  const [solver, setSolver] = useState<"loading" | "ready" | "failed">("loading");
  const [solverDetail, setSolverDetail] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [progress, setProgress] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryState>({ undo: [], redo: [] });
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const optimizer = useRef<ReturnType<typeof createOptimizer> | null>(null);

  useEffect(() => {
    const client = createOptimizer((ready) => {
      setSolver(ready.ok ? "ready" : "failed");
      setSolverDetail(ready.detail);
    });
    optimizer.current = client;
    return () => client.dispose();
  }, []);

  useEffect(() => {
    const onHash = () => {
      const raw = window.location.hash.replace("#", "");
      setSectionState(parseSection(window.location.hash));
      if (raw === "requirements") window.location.hash = "rotations";
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    void loadSnapshot()
      .then((saved) => {
        if (saved?.project?.formatVersion === 1) {
          const legacyDemo = saved.project.name === "Synthetic internal medicine program" || (saved.project.id === "im-demo" && saved.project.name === "Internal Medicine");
          const name = legacyDemo ? "Sample program" : saved.project.name;
          setSnapshot(name === saved.project.name ? saved : { ...saved, project: { ...saved.project, name } });
        }
        setHydrated(true);
      })
      .catch(() => {
        setNotice("This browser refused local storage. Changes will not be saved.");
        setHydrated(true);
      });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      void saveSnapshot(snapshotRef.current).catch(() => {
        setNotice("Automatic save failed. Export a backup before closing this tab.");
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [snapshot, hydrated]);

  useEffect(() => {
    if (!optimizing) return;
    const started = performance.now();
    const timer = window.setInterval(() => setElapsed((performance.now() - started) / 1000), 400);
    return () => window.clearInterval(timer);
  }, [optimizing]);

  const api = useMemo<AppValue>(() => {
    const commit = (next: Snapshot) => setSnapshot(next);
    return {
      hydrated,
      solver,
      solverDetail,
      section,
      snapshot,
      selected,
      optimizing,
      progress,
      elapsed,
      result,
      notice,
      canUndo: history.undo.length > 0,
      canRedo: history.redo.length > 0,
      setSection: (next) => {
        window.location.hash = next;
      },
      setNotice,
      updateProject: (recipe, audit) => {
        const next = { ...snapshotRef.current, project: recipe(snapshotRef.current.project) };
        commit(audit ? withAudit(next, "edit", audit) : next);
      },
      replaceSnapshot: (next, detail) => {
        setHistory({ undo: [], redo: [] });
        setSelected([]);
        setResult(null);
        commit(withAudit(next, "replace", detail));
      },
      updateSettings: (settings) => commit({ ...snapshotRef.current, settings }),
      toggleSelected: (id) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id])),
      setSelected,
      setAssignments: (assignments) => {
        const previous = snapshotRef.current.project.assignments;
        setHistory((current) => ({ undo: [...current.undo, previous].slice(-40), redo: [] }));
        commit({ ...snapshotRef.current, project: { ...snapshotRef.current.project, assignments } });
      },
      undo: () => {
        setHistory((current) => {
          const previous = current.undo[current.undo.length - 1];
          if (!previous) return current;
          const present = snapshotRef.current.project.assignments;
          setSnapshot((snap) => ({ ...snap, project: { ...snap.project, assignments: previous } }));
          return { undo: current.undo.slice(0, -1), redo: [...current.redo, present] };
        });
      },
      redo: () => {
        setHistory((current) => {
          const next = current.redo[current.redo.length - 1];
          if (!next) return current;
          const present = snapshotRef.current.project.assignments;
          setSnapshot((snap) => ({ ...snap, project: { ...snap.project, assignments: next } }));
          return { undo: [...current.undo, present], redo: current.redo.slice(0, -1) };
        });
      },
      generate: () => {
        if (!optimizer.current || solver !== "ready" || optimizing) return;
        setOptimizing(true);
        setElapsed(0);
        setProgress("Generating schedule");
        setResult(null);
        void optimizer.current
          .optimize(snapshotRef.current.project, { ...snapshotRef.current.settings, generateAlternatives: true }, () => setProgress("Generating schedule"))
          .then((outcome) => {
            setResult(outcome);
            setSnapshot((current) => withAudit({ ...current, settings: { ...current.settings, generateAlternatives: true } }, "optimize", outcome.message));
            const ready = topSolutions(outcome.proposals);
            if (ready.length) setNotice(ready.length === 1 ? "1 solution is ready to preview." : `${ready.length} solutions are ready to preview.`);
            else setNotice(outcome.cancelled ? "Optimization was cancelled." : outcome.message);
          })
          .catch((error: unknown) => {
            setNotice(error instanceof Error ? `Schedule generation failed: ${error.message}` : "Schedule generation failed.");
          })
          .finally(() => setOptimizing(false));
      },
      stop: () => {
        setSolver("loading");
        setSolverDetail("");
        optimizer.current?.stop();
      },
      applyProposal: (proposal) => {
        setSnapshot((current) => withAudit(withProposal(current, proposal), "apply-proposal", proposal.title));
        setHistory({ undo: [], redo: [] });
        setNotice("Schedule applied.");
        setSectionState("schedule");
        window.location.hash = "schedule";
      },
      rejectProposal: (proposal) => {
        setSnapshot((current) => withAudit(current, "reject-proposal", proposal.title));
        setNotice("Proposal rejected. Schedule unchanged.");
      },
      loadScenario: (kind) => {
        const project =
          kind === "conflict" ? buildResolvableConflict() : kind === "immutable" ? buildImmutableConflict() : kind === "empty" ? buildEmptyProject() : buildInternalMedicineDemo();
        setHistory({ undo: [], redo: [] });
        setSelected([]);
        setResult(null);
        setSnapshot((current) => withAudit({ ...snapshotOf(project), settings: current.settings }, "load-scenario", project.name));
        setNotice("Program loaded.");
      },
      clearStorage: async () => {
        await clearSnapshot();
        setNotice("Local storage cleared.");
      },
    };
  }, [elapsed, history.redo.length, history.undo.length, hydrated, notice, optimizing, progress, result, section, selected, snapshot, solver, solverDetail]);

  return <AppContext.Provider value={api}>{children}</AppContext.Provider>;
}
