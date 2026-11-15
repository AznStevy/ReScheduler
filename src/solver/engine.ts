import type {
  AppliedRelaxation,
  Assignment,
  ConflictFinding,
  ModelStats,
  OptimizeResult,
  OptimizationSettings,
  Project,
  Proposal,
  ProposalKind,
  StageResult,
} from "@/domain/types";
import { forcedChoice } from "@/domain/eligibility";
import { evaluate, expr, safeToken, type LinearExpr } from "./lp";
import { assignmentFingerprint, impactLines, measureSchedule } from "./metrics";
import { buildModel, describeSlack, type BuiltModel, type SlackVar } from "./model";
import { diagnose } from "./diagnose";
import type { Solver, SolverOptions } from "./solver";
import { validateSchedule } from "./validate";

export interface OptimizeHooks {
  cancelled: () => boolean;
  progress: (stage: string, detail: string) => void;
  yield: () => Promise<void>;
}

interface StagePlan {
  id: string;
  label: string;
  expression: LinearExpr;
  maximize: boolean;
}

interface Fix {
  name: string;
  terms: [string, number][];
  rhs: number;
}

interface Chain {
  values: Record<string, number> | null;
  stages: StageResult[];
  fixes: Fix[];
  provenOptimal: boolean;
  stopped: "ok" | "infeasible" | "timeout" | "cancelled";
}

const TITLES: Record<ProposalKind, string> = {
  balanced: "Balanced lexicographic schedule",
  vacation: "Best vacation preservation",
  fairness: "Best fairness",
  career: "Best career-interest alignment",
  stability: "Minimum changes to the current schedule",
};

const EMPTY_STATS: ModelStats = {
  binaries: 0,
  integers: 0,
  continuous: 0,
  constraints: 0,
  eliminatedAssignments: 0,
  possibleAssignments: 0,
  warning: null,
};

export async function optimizeSchedule(
  project: Project,
  settings: OptimizationSettings,
  solver: Solver,
  hooks: OptimizeHooks,
): Promise<OptimizeResult> {
  const findings = dedupe([...diagnose(project)]);
  const strict = buildModel(project, { relax: false });
  const merged = dedupe([...findings, ...strict.findings]);
  if (hooks.cancelled()) return cancelledResult(merged, strict.stats);
  if (strict.fatal) {
    return {
      solver: "highs",
      cancelled: false,
      provedInfeasible: true,
      feasible: false,
      message:
        "No valid schedule can be generated. Immutable locks, protected leave, or eligibility rules contradict each other, so the solver was not asked to drop them.",
      findings: merged,
      proposals: [],
      stats: strict.stats,
      stages: [],
    };
  }

  const remaining = timeBudget(settings.timeLimitSeconds);
  const kinds = settings.generateAlternatives
    ? (["balanced", "vacation", "fairness", "career", "stability"] as const)
    : (["balanced"] as const);
  const proposals: Proposal[] = [];
  const exclusions: Fix[] = [];
  let primary: Chain | null = null;
  for (let index = 0; index < kinds.length; index += 1) {
    if (hooks.cancelled()) return cancelledResult(merged, strict.stats);
    if (remaining() <= 0.05) break;
    const kind = kinds[index];
    const share = index === 0 && kinds.length > 1 ? Math.min(remaining(), settings.timeLimitSeconds * 0.5) : remaining() / (kinds.length - index);
    const forbid = kind === "vacation" || kind === "fairness" || kind === "career" ? exclusions : [];
    const chain = await runPlans(strict, plansFor(kind, strict), forbid, settings, solver, hooks, shareBudget(remaining, share));
    if (index === 0) {
      primary = chain;
      if (chain.stopped === "cancelled") return cancelledResult(merged, strict.stats);
      if (chain.stopped === "infeasible" && !chain.values) {
        return resolveConflict(project, settings, solver, hooks, merged, strict.stats, remaining);
      }
    }
    if (!chain.values) continue;
    const proposal = toProposal(project, strict, kind, chain, []);
    proposals.push(proposal);
    const cut = exclusionCut(strict, chain.values, exclusions.length);
    if (proposal.validation.ok && cut) exclusions.push(cut);
  }
  if (!proposals.length) {
    return {
      solver: "highs",
      cancelled: false,
      provedInfeasible: false,
      feasible: false,
      message: "No solution was found within the time limit.",
      findings: merged,
      proposals: [],
      stats: strict.stats,
      stages: primary?.stages ?? [],
    };
  }
  return finish(proposals, merged, strict.stats, primary?.stages ?? proposals[0].stages, false);
}

async function resolveConflict(
  project: Project,
  settings: OptimizationSettings,
  solver: Solver,
  hooks: OptimizeHooks,
  findings: ConflictFinding[],
  stats: ModelStats,
  remaining: () => number,
): Promise<OptimizeResult> {
  hooks.progress("Conflict diagnosis", "Strict model is infeasible. Testing authorized relaxations.");
  const targeted = await targetedFindings(project, settings, solver, hooks, remaining);
  const withTargeted = dedupe([...findings, ...targeted]);
  const relaxed = buildModel(project, { relax: true });
  if (relaxed.fatal || relaxed.slacks.length === 0) {
    return {
      solver: "highs",
      cancelled: false,
      provedInfeasible: true,
      feasible: false,
      message:
        "No valid schedule can be generated. The immutable constraints are infeasible, and no authorized relaxation restores feasibility.",
      findings: withTargeted,
      proposals: [],
      stats: relaxed.stats.binaries ? relaxed.stats : stats,
      stages: [],
    };
  }
  const prefix = await runPlans(relaxed, slackPlans(relaxed), [], settings, solver, hooks, remaining);
  if (prefix.stopped === "cancelled") return cancelledResult(withTargeted, relaxed.stats);
  if (prefix.stopped === "infeasible" || !prefix.values) {
    return {
      solver: "highs",
      cancelled: false,
      provedInfeasible: prefix.stopped === "infeasible",
      feasible: false,
      message:
        prefix.stopped === "infeasible"
          ? "No valid schedule can be generated. Authorized relaxations were included, and the solver still proved the model infeasible."
          : "No solution was found within the time limit.",
      findings: withTargeted,
      proposals: [],
      stats: relaxed.stats,
      stages: prefix.stages,
    };
  }
  const proposals: Proposal[] = [];
  const exclusions: Fix[] = [];
  const kinds = ["balanced", "vacation", "fairness", "career", "stability"] as const;
  for (let index = 0; index < kinds.length; index += 1) {
    if (hooks.cancelled()) return cancelledResult(withTargeted, relaxed.stats);
    const kind = kinds[index];
    if (remaining() <= 0.05) {
      if (!proposals.length && prefix.values) {
        proposals.push(toProposal(project, relaxed, "balanced", {
          values: prefix.values,
          stages: prefix.stages,
          fixes: prefix.fixes,
          provenOptimal: false,
          stopped: "timeout",
        }, readRelaxations(project, relaxed, prefix.values)));
      }
      break;
    }
    const share = remaining() / (kinds.length - index);
    const forbid = kind === "vacation" || kind === "fairness" || kind === "career" ? exclusions : [];
    const tail = await runPlans(relaxed, plansFor(kind, relaxed), [...prefix.fixes, ...forbid], settings, solver, hooks, shareBudget(remaining, share));
    const values = tail.values ?? (index === 0 ? prefix.values : null);
    if (!values) continue;
    const chain: Chain = {
      values,
      stages: [...prefix.stages, ...tail.stages],
      fixes: tail.fixes,
      provenOptimal: prefix.provenOptimal && tail.provenOptimal && tail.values != null,
      stopped: tail.stopped,
    };
    const proposal = toProposal(project, relaxed, kind, chain, readRelaxations(project, relaxed, values));
    proposals.push(proposal);
    const cut = exclusionCut(relaxed, values, exclusions.length);
    if (proposal.validation.ok && cut) exclusions.push(cut);
  }
  const result = finish(proposals, withTargeted, relaxed.stats, prefix.stages, true);
  if (!result.feasible) {
    result.message =
      "No valid schedule can be generated. Relaxed candidates failed independent validation, so they were not accepted.";
  }
  return result;
}

function finish(
  proposals: Proposal[],
  findings: ConflictFinding[],
  stats: ModelStats,
  stages: StageResult[],
  relaxed: boolean,
): OptimizeResult {
  markDuplicates(proposals);
  const usable = proposals.filter((proposal) => proposal.validation.ok);
  const proved = usable.length > 0 && usable.every((proposal) => proposal.provenOptimal);
  const visible = !relaxed && usable.length > 0 ? findings.filter((finding) => finding.severity !== "immutable") : findings;
  let message: string;
  if (usable.length === 0) {
    message = "The solver returned a candidate that failed independent validation. It was not accepted as a schedule.";
  } else if (relaxed) {
    message = proved
      ? "The strict model is infeasible. These proposals are feasible only with the listed authorized relaxations, and those solves were proved optimal."
      : "The strict model is infeasible. These proposals are feasible only with the listed authorized relaxations. Optimality was not proved for every stage.";
  } else if (proved) {
    message = "A feasible schedule was found, and every lexicographic stage in the returned proposals was proved optimal.";
  } else {
    message = "A feasible schedule was found. Optimality was not proved for every stage, so the result is not labeled optimal.";
  }
  return {
    solver: "highs",
    cancelled: false,
    provedInfeasible: false,
    feasible: usable.length > 0,
    message,
    findings: visible,
    proposals,
    stats,
    stages,
  };
}

async function runPlans(
  built: BuiltModel,
  plans: StagePlan[],
  initialFixes: Fix[],
  settings: OptimizationSettings,
  solver: Solver,
  hooks: OptimizeHooks,
  remaining: () => number,
): Promise<Chain> {
  const active = plans.filter((plan) => plan.expression.size > 0);
  const queue = active.length > 0 ? active : [{ id: "feasibility", label: "Feasibility", expression: expr(), maximize: false }];
  const fixes = [...initialFixes];
  const stages: StageResult[] = [];
  let values: Record<string, number> | null = null;
  let provenOptimal = true;
  for (const plan of queue) {
    if (hooks.cancelled()) return { values, stages, fixes, provenOptimal: false, stopped: "cancelled" };
    if (remaining() <= 0) {
      return { values, stages, fixes, provenOptimal: false, stopped: values ? "ok" : "timeout" };
    }
    hooks.progress(plan.label, "Solving");
    let output = solvePlan(built, plan, fixes, settings, solver, hooks, remaining);
    if (isInfeasible(output.status) && values) {
      const loosened = fixes.map((fix, index) => (index === fixes.length - 1 ? { ...fix, rhs: fix.rhs + 0.05 } : fix));
      output = solvePlan(built, plan, loosened, settings, solver, hooks, remaining);
    }
    const display = output.objective == null ? null : plan.maximize ? -output.objective : output.objective;
    stages.push({
      id: plan.id,
      label: plan.label,
      status: output.status,
      displayObjective: display,
      runtimeSeconds: output.runtimeSeconds,
      gap: output.gap,
      provenOptimal: output.provenOptimal && settings.mipRelGap === 0,
    });
    if (isInfeasible(output.status) || !output.hasSolution) {
      return {
        values,
        stages,
        fixes,
        provenOptimal: false,
        stopped: isInfeasible(output.status) ? "infeasible" : "timeout",
      };
    }
    values = output.values;
    if (!(output.provenOptimal && settings.mipRelGap === 0)) provenOptimal = false;
    const achieved = evaluate(plan.expression, output.values);
    if (plan.expression.size > 0) {
      fixes.push({
        name: `fix_${safeToken(plan.id)}_${fixes.length}`,
        terms: [...plan.expression.entries()],
        rhs: minimizationBound(achieved),
      });
    }
    await hooks.yield();
  }
  return { values, stages, fixes, provenOptimal: provenOptimal && values != null, stopped: "ok" };
}

function solvePlan(
  built: BuiltModel,
  plan: StagePlan,
  fixes: Fix[],
  settings: OptimizationSettings,
  solver: Solver,
  hooks: OptimizeHooks,
  remaining: () => number,
) {
  const allowance = remaining();
  if (allowance <= 0) {
    return { status: "Time limit reached", provenOptimal: false, hasSolution: false, objective: null, values: {}, runtimeSeconds: 0, gap: null };
  }
  const lp = built.lp.clone();
  for (const fix of fixes) lp.addConstraint(fix.name, fix.terms, "<=", fix.rhs);
  const options: SolverOptions = {
    timeLimitSeconds: allowance,
    randomSeed: settings.randomSeed,
    mipRelGap: settings.mipRelGap,
  };
  return solver.solve(lp.serialize(plan.expression), options, (progress) => {
    const gap = progress.gap == null ? "" : ` Gap ${progress.gap.toFixed(3)}.`;
    hooks.progress(plan.label, `HiGHS is searching.${gap}`);
  });
}

function plansFor(kind: ProposalKind, built: BuiltModel): StagePlan[] {
  const vacation = plan("vacation", "Vacation preferences", built.objectives.vacation, true);
  const fairness = plan("fairness", "Fairness", built.objectives.fairness, false);
  const career = plan("career", "Career interests", built.objectives.career, true);
  const changes = plan("changes", "Schedule stability", built.objectives.changes, true);
  const spacing = plan("spacing", "Rotation spacing", built.objectives.spacing, false);
  if (kind === "vacation") return [vacation, changes];
  if (kind === "fairness") return [fairness, changes];
  if (kind === "career") return [career, changes];
  if (kind === "stability") return [changes, spacing];
  return [vacation, fairness, career, changes, spacing];
}

function slackPlans(built: BuiltModel): StagePlan[] {
  return [
    plan("slack-priority", "High-priority relaxations", built.objectives.highPrioritySlack, false),
    plan("slack-magnitude", "Relaxation magnitude", built.objectives.slackMagnitude, false),
    plan("slack-residents", "Residents affected", built.objectives.affectedResidents, false),
  ];
}

function plan(id: string, label: string, expression: LinearExpr, maximize: boolean): StagePlan {
  return { id, label, expression, maximize };
}

function toProposal(project: Project, built: BuiltModel, kind: ProposalKind, chain: Chain, preset: AppliedRelaxation[]): Proposal {
  const values = chain.values ?? {};
  const assignments = readAssignments(project, built, values);
  const relaxations = preset.length > 0 || built.slacks.length === 0 ? preset : readRelaxations(project, built, values);
  const validation = validateSchedule(project, assignments, { requireComplete: true, relaxations });
  const metrics = measureSchedule(project, assignments, relaxations);
  const title = kind === "balanced" && relaxations.length > 0 ? "Minimum total relaxation" : TITLES[kind];
  const optimalText = chain.provenOptimal ? "Every stage in this proposal was proved optimal." : "Optimality was not proved for every stage.";
  return {
    id: `proposal-${kind}`,
    kind,
    title,
    summary: validation.ok
      ? `${optimalText} ${relaxations.length} authorized relaxation(s) are used.`
      : `This candidate failed independent validation and cannot be applied. ${optimalText}`,
    assignments,
    relaxations,
    metrics,
    validation,
    provenOptimal: chain.provenOptimal && validation.ok,
    stages: chain.stages,
    impacts: impactLines(project, metrics, relaxations),
    duplicateOf: null,
  };
}

function readAssignments(project: Project, built: BuiltModel, values: Record<string, number>): Assignment[] {
  const assignments: Assignment[] = [];
  for (const variable of built.assignments) {
    if ((values[variable.name] ?? 0) <= 0.5) continue;
    const resident = project.residents.find((item) => item.id === variable.residentId);
    const forced = resident ? forcedChoice(project, resident, variable.blockId) : { rotationId: null, sources: [] as string[], conflict: false };
    const locked = forced.rotationId === variable.rotationId && forced.sources.some((source) => source !== "locked block" && source !== "locked resident");
    assignments.push({
      residentId: variable.residentId,
      blockId: variable.blockId,
      rotationId: variable.rotationId,
      locked,
      source: locked ? "locked" : "optimizer",
    });
  }
  return assignments;
}

function readRelaxations(project: Project, built: BuiltModel, values: Record<string, number>): AppliedRelaxation[] {
  return built.slacks.flatMap((slack) => {
    const amount = Math.round(values[slack.name] ?? 0);
    if (amount <= 0) return [];
    return [slackToRelaxation(project, slack, amount)];
  });
}

function slackToRelaxation(project: Project, slack: SlackVar, amount: number): AppliedRelaxation {
  return {
    id: slack.name,
    kind: slack.kind,
    amount,
    residentId: slack.residentId,
    requirementId: slack.requirementId,
    blockId: slack.blockId,
    rotationId: slack.rotationId,
    priority: slack.priority,
    description: describeSlack(project, slack, amount),
  };
}

function timeBudget(seconds: number): () => number {
  const deadline = performance.now() + Math.max(0, seconds) * 1000;
  return () => Math.max(0, (deadline - performance.now()) / 1000);
}

function shareBudget(global: () => number, seconds: number): () => number {
  const deadline = performance.now() + Math.max(0, seconds) * 1000;
  return () => Math.max(0, Math.min(global(), (deadline - performance.now()) / 1000));
}

function exclusionCut(built: BuiltModel, values: Record<string, number>, index: number): Fix | null {
  const chosen = built.assignments.filter((variable) => (values[variable.name] ?? 0) > 0.5);
  if (!chosen.length) return null;
  return {
    name: `exclude_${index}`,
    terms: chosen.map((variable) => [variable.name, 1]),
    rhs: chosen.length - 1,
  };
}

async function targetedFindings(
  project: Project,
  settings: OptimizationSettings,
  solver: Solver,
  hooks: OptimizeHooks,
  remaining: () => number,
): Promise<ConflictFinding[]> {
  if (project.residents.length * project.blocks.length > 80) return [];
  const groups: { requirementId?: string; rotationId?: string; label: string; id: string }[] = [];
  for (const requirement of project.requirements) {
    if (requirement.relaxable && requirement.priority > 0 && requirement.maxRelaxation > 0) {
      groups.push({ requirementId: requirement.id, label: requirement.name, id: requirement.id });
    }
  }
  for (const rotation of project.rotations) {
    if (rotation.staffingPriority > 0 && (rotation.relaxStaffingMin > 0 || rotation.relaxStaffingMax > 0)) {
      groups.push({ rotationId: rotation.id, label: rotation.name, id: rotation.id });
    }
  }
  const findings: ConflictFinding[] = [];
  for (const group of groups.slice(0, 8)) {
    if (hooks.cancelled()) break;
    const built = buildModel(project, {
      relax: true,
      onlyRequirementId: group.requirementId,
      onlyRotationId: group.rotationId,
    });
    if (built.fatal || built.slacks.length === 0) continue;
    hooks.progress("Conflict diagnosis", `Testing a relaxation of ${group.label}`);
    const allowance = remaining();
    if (allowance <= 0) break;
    const output = solver.solve(built.lp.serialize(expr()), {
      timeLimitSeconds: Math.min(3, allowance),
      randomSeed: settings.randomSeed,
      mipRelGap: settings.mipRelGap,
    });
    if (!output.hasSolution || isInfeasible(output.status)) continue;
    findings.push({
      id: `targeted-${group.id}`,
      severity: "relaxable",
      title: `Relaxing ${group.label} can restore a feasible schedule`,
      detail:
        "A targeted solver test became feasible after relaxing only this authorized group. Other groups were not proved irrelevant, so this is not a minimal conflict set.",
      verified: "solver-tested",
      minimal: false,
      residentIds: [],
      blockIds: [],
      rotationIds: group.rotationId ? [group.rotationId] : [],
      requirementIds: group.requirementId ? [group.requirementId] : [],
    });
    await hooks.yield();
  }
  return findings;
}

function markDuplicates(proposals: Proposal[]): void {
  const seen = new Map<string, string>();
  for (const proposal of proposals) {
    if (!proposal.validation.ok) continue;
    const fingerprint = assignmentFingerprint(proposal.assignments);
    const prior = seen.get(fingerprint);
    if (prior) proposal.duplicateOf = prior;
    else seen.set(fingerprint, proposal.title);
  }
}

function isInfeasible(status: string): boolean {
  return status === "Infeasible" || status === "Primal infeasible or unbounded";
}

function minimizationBound(value: number): number {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-3) return rounded + 1e-4;
  return value + 1e-3;
}

function dedupe(findings: ConflictFinding[]): ConflictFinding[] {
  const seen = new Set<string>();
  return findings.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function cancelledResult(findings: ConflictFinding[], stats: ModelStats): OptimizeResult {
  return {
    solver: "highs",
    cancelled: true,
    provedInfeasible: false,
    feasible: false,
    message: "Optimization was cancelled before a validated schedule was accepted.",
    findings,
    proposals: [],
    stats,
    stages: [],
  };
}

export function blankStats(): ModelStats {
  return EMPTY_STATS;
}
