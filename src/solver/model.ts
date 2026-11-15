import { canStart, forcedChoice, isEligible } from "@/domain/eligibility";
import { isPastBlock } from "@/domain/calendar";
import {
  blockById,
  blockCredit,
  requirementApplies,
  residentById,
  rotationById,
  staffingLimits,
  vacationRotation,
  waiverCredit,
} from "@/domain/lookups";
import { rotationPreferencePoints, vacationChoicePoints } from "@/domain/preferences";
import { creditingRotations, futureCapacity, historicalCredit, requirementProgress, yearsAfterCurrent } from "@/domain/progress";
import type { ConflictFinding, ModelStats, Project, Requirement, Resident, Rotation } from "@/domain/types";
import { LpModel, addTerm, expr, safeToken, type LinearExpr } from "./lp";

export interface AssignVar {
  name: string;
  residentId: string;
  blockId: string;
  rotationId: string;
}

export interface SlackVar {
  name: string;
  kind: "requirement" | "staffing-min" | "staffing-max";
  residentId?: string;
  requirementId?: string;
  blockId?: string;
  rotationId?: string;
  priority: number;
}

export interface BuiltModel {
  lp: LpModel;
  assignments: AssignVar[];
  slacks: SlackVar[];
  objectives: {
    vacation: LinearExpr;
    fairness: LinearExpr;
    career: LinearExpr;
    changes: LinearExpr;
    spacing: LinearExpr;
    highPrioritySlack: LinearExpr;
    slackMagnitude: LinearExpr;
    affectedResidents: LinearExpr;
  };
  findings: ConflictFinding[];
  fatal: boolean;
  stats: ModelStats;
}

export interface BuildOptions {
  relax: boolean;
  onlyRequirementId?: string;
  onlyRotationId?: string;
}

function finding(
  id: string,
  severity: ConflictFinding["severity"],
  title: string,
  detail: string,
  extra: Partial<Pick<ConflictFinding, "residentIds" | "blockIds" | "rotationIds" | "requirementIds">> = {},
): ConflictFinding {
  return {
    id,
    severity,
    title,
    detail,
    verified: "structural",
    minimal: false,
    residentIds: extra.residentIds ?? [],
    blockIds: extra.blockIds ?? [],
    rotationIds: extra.rotationIds ?? [],
    requirementIds: extra.requirementIds ?? [],
  };
}

function sizeWarning(binaries: number): string | null {
  if (binaries > 20_000) {
    return `This model has ${binaries.toLocaleString()} binary variables. A browser solve may be slow or run out of memory. No heuristic schedule will be substituted.`;
  }
  if (binaries > 12_000) {
    return `This model has ${binaries.toLocaleString()} binary variables. The solve may take a while. You can stop it without losing the current schedule.`;
  }
  return null;
}

function allowSlack(options: BuildOptions, requirementId?: string, rotationId?: string): boolean {
  if (!options.relax) return false;
  if (options.onlyRequirementId) return requirementId === options.onlyRequirementId;
  if (options.onlyRotationId) return rotationId === options.onlyRotationId;
  return true;
}

export function buildModel(project: Project, options: BuildOptions): BuiltModel {
  const lp = new LpModel();
  const assignments: AssignVar[] = [];
  const slacks: SlackVar[] = [];
  const findings: ConflictFinding[] = [];
  let fatal = false;
  const objectives = {
    vacation: expr(),
    fairness: expr(),
    career: expr(),
    changes: expr(),
    spacing: expr(),
    highPrioritySlack: expr(),
    slackMagnitude: expr(),
    affectedResidents: expr(),
  };
  const possible = project.residents.length * project.blocks.length * project.rotations.length;
  const residentsById = new Map(project.residents.map((resident) => [resident.id, resident]));
  const startNames = new Set<string>();

  const ensureSeat = (resident: Resident, blockIndex: number, rotation: Rotation, fixed: boolean) => {
    const block = project.blocks[blockIndex];
    const name = `x_${safeToken(resident.id)}_${safeToken(block.id)}_${safeToken(rotation.id)}`;
    if (!assignments.some((item) => item.name === name)) {
      lp.addBinary(name, fixed ? 1 : 0, 1);
      assignments.push({ name, residentId: resident.id, blockId: block.id, rotationId: rotation.id });
    } else if (fixed) {
      lp.addBinary(name, 1, 1);
    }
    return name;
  };

  for (const resident of project.residents) {
    for (const block of project.blocks) {
      const forced = forcedChoice(project, resident, block.id);
      if (forced.conflict) {
        fatal = true;
        findings.push(
          finding(
            `lock-conflict-${resident.id}-${block.id}`,
            "immutable",
            `${resident.name} has conflicting locked assignments in ${block.label}`,
            `The locked choices come from ${forced.sources.join(" and ")}. Protected leave and locks are not changed automatically.`,
            { residentIds: [resident.id], blockIds: [block.id] },
          ),
        );
        continue;
      }
      if (forced.rotationId) {
        const rotation = rotationById(project, forced.rotationId);
        if (!rotation || !isEligible(project, resident, rotation, block)) {
          fatal = true;
          findings.push(
            finding(
              `lock-ineligible-${resident.id}-${block.id}`,
              "immutable",
              `${resident.name} is locked to an ineligible rotation in ${block.label}`,
              rotation
                ? `${rotation.name} cannot be assigned to this resident in ${block.label}, and the lock is immutable.`
                : "The locked rotation does not exist.",
              { residentIds: [resident.id], blockIds: [block.id], rotationIds: rotation ? [rotation.id] : [] },
            ),
          );
          continue;
        }
        ensureSeat(resident, block.index, rotation, true);
        continue;
      }
      for (const rotation of project.rotations) {
        if (rotation.durationBlocks > 1) continue;
        if (!isEligible(project, resident, rotation, block)) continue;
        ensureSeat(resident, block.index, rotation, false);
      }
    }
    for (const block of project.blocks) {
      for (const rotation of project.rotations) {
        if (rotation.durationBlocks <= 1) continue;
        if (!canStart(project, resident, rotation, block)) continue;
        const start = `s_${safeToken(resident.id)}_${safeToken(block.id)}_${safeToken(rotation.id)}`;
        if (startNames.has(start)) continue;
        lp.addBinary(start);
        startNames.add(start);
        for (let offset = 0; offset < rotation.durationBlocks; offset += 1) {
          const covered = project.blocks[block.index + offset];
          const coveredForce = forcedChoice(project, resident, covered.id);
          ensureSeat(resident, covered.index, rotation, coveredForce.rotationId === rotation.id);
        }
      }
    }
    for (const block of project.blocks) {
      const seated = assignments.some((item) => item.residentId === resident.id && item.blockId === block.id);
      if (seated) continue;
      fatal = true;
      findings.push(
        finding(
          `no-seat-${resident.id}-${block.id}`,
          "immutable",
          `${resident.name} has no eligible rotation in ${block.label}`,
          "Every resident needs exactly one eligible rotation in every block. This block has none, so no schedule can be generated.",
          { residentIds: [resident.id], blockIds: [block.id] },
        ),
      );
    }
  }

  const namesFor = (residentId: string, blockId: string) =>
    assignments.filter((item) => item.residentId === residentId && item.blockId === blockId);

  for (const resident of project.residents) {
    for (const block of project.blocks) {
      const vars = namesFor(resident.id, block.id);
      if (vars.length === 0) continue;
      lp.addConstraint(
        `seat_${safeToken(resident.id)}_${safeToken(block.id)}`,
        vars.map((item) => [item.name, 1]),
        "=",
        1,
      );
    }
  }

  for (const resident of project.residents) {
    for (const rotation of project.rotations) {
      if (rotation.durationBlocks <= 1) continue;
      for (const block of project.blocks) {
        const covered = assignments.find(
          (item) => item.residentId === resident.id && item.blockId === block.id && item.rotationId === rotation.id,
        );
        if (!covered) continue;
        const starts: [string, number][] = [];
        for (let origin = block.index - rotation.durationBlocks + 1; origin <= block.index; origin += 1) {
          const originBlock = project.blocks[origin];
          if (!originBlock) continue;
          const start = `s_${safeToken(resident.id)}_${safeToken(originBlock.id)}_${safeToken(rotation.id)}`;
          if (startNames.has(start)) starts.push([start, 1]);
        }
        lp.addConstraint(`link_${covered.name}`, [[covered.name, 1], ...starts.map(([name]) => [name, -1] as [string, number])], "=", 0);
      }
    }
  }

  for (const rotation of project.rotations) {
    for (const block of project.blocks) {
      const limits = staffingLimits(project, rotation, block.id);
      let min = limits.min;
      let max = limits.max;
      for (const waiver of project.staffingWaivers) {
        if (waiver.blockId !== block.id || waiver.rotationId !== rotation.id) continue;
        min -= waiver.minReduction;
        max += waiver.maxIncrease;
      }
      min = Math.max(0, min);
      const vars = assignments.filter((item) => item.blockId === block.id && item.rotationId === rotation.id);
      if (min > 0) {
        const terms: [string, number][] = vars.map((item) => [item.name, 1]);
        const remaining = Math.max(0, rotation.relaxStaffingMin - grantedMin(project, block.id, rotation.id));
        if (allowSlack(options, undefined, rotation.id) && rotation.staffingPriority > 0 && remaining > 0) {
          const name = `smin_${safeToken(block.id)}_${safeToken(rotation.id)}`;
          lp.addInteger(name, 0, remaining);
          terms.push([name, 1]);
          slacks.push({ name, kind: "staffing-min", blockId: block.id, rotationId: rotation.id, priority: rotation.staffingPriority });
          addTerm(objectives.slackMagnitude, name, 1);
          if (rotation.staffingPriority <= 1) addTerm(objectives.highPrioritySlack, name, 1);
        }
        lp.addConstraint(`min_${safeToken(rotation.id)}_${safeToken(block.id)}`, terms, ">=", min);
      }
      const increase = Math.max(0, rotation.relaxStaffingMax - grantedMax(project, block.id, rotation.id));
      const maxTerms: [string, number][] = vars.map((item) => [item.name, 1]);
      if (allowSlack(options, undefined, rotation.id) && rotation.staffingPriority > 0 && increase > 0) {
        const name = `smax_${safeToken(block.id)}_${safeToken(rotation.id)}`;
        lp.addInteger(name, 0, increase);
        maxTerms.push([name, -1]);
        slacks.push({ name, kind: "staffing-max", blockId: block.id, rotationId: rotation.id, priority: rotation.staffingPriority });
        addTerm(objectives.slackMagnitude, name, 1);
        if (rotation.staffingPriority <= 1) addTerm(objectives.highPrioritySlack, name, 1);
      }
      lp.addConstraint(`max_${safeToken(rotation.id)}_${safeToken(block.id)}`, maxTerms, "<=", max);
    }
  }

  for (const resident of project.residents) {
    for (const rotation of project.rotations) {
      if (rotation.maxBlocksPerResident == null) continue;
      const vars = assignments.filter((item) => item.residentId === resident.id && item.rotationId === rotation.id);
      if (vars.length === 0) continue;
      lp.addConstraint(
        `cap_${safeToken(resident.id)}_${safeToken(rotation.id)}`,
        vars.map((item) => [item.name, 1]),
        "<=",
        rotation.maxBlocksPerResident,
      );
    }
    if (rotationHasConsecutive(project)) {
      for (const rotation of project.rotations) {
        if (rotation.maxConsecutive == null) continue;
        const window = rotation.maxConsecutive + 1;
        for (let index = 0; index + window <= project.blocks.length; index += 1) {
          const terms: [string, number][] = [];
          for (let offset = 0; offset < window; offset += 1) {
            const block = project.blocks[index + offset];
            const variable = assignments.find(
              (item) => item.residentId === resident.id && item.blockId === block.id && item.rotationId === rotation.id,
            );
            if (variable) terms.push([variable.name, 1]);
          }
          if (terms.length > rotation.maxConsecutive) {
            lp.addConstraint(`seq_${safeToken(resident.id)}_${safeToken(rotation.id)}_${index}`, terms, "<=", rotation.maxConsecutive);
          }
        }
      }
    }
    for (let index = 0; index < project.blocks.length - 1; index += 1) {
      const left = project.blocks[index];
      const right = project.blocks[index + 1];
      for (const first of project.rotations) {
        if (first.noConsecutiveCategories.length === 0) continue;
        const leftVar = assignments.find((item) => item.residentId === resident.id && item.blockId === left.id && item.rotationId === first.id);
        if (!leftVar) continue;
        for (const second of project.rotations) {
          if (!first.noConsecutiveCategories.includes(second.category)) continue;
          const rightVar = assignments.find(
            (item) => item.residentId === resident.id && item.blockId === right.id && item.rotationId === second.id,
          );
          if (!rightVar) continue;
          lp.addConstraint(`adj_${leftVar.name}_${rightVar.name}`, [[leftVar.name, 1], [rightVar.name, 1]], "<=", 1);
        }
      }
    }
    for (const rotation of project.rotations) {
      for (const prerequisite of rotation.prerequisites) {
        const historical =
          resident.previousRotations.find((item) => item.rotationId === prerequisite.rotationId)?.blocks ?? 0;
        if (historical >= prerequisite.blocks) continue;
        for (const block of project.blocks) {
          const variable = assignments.find(
            (item) => item.residentId === resident.id && item.blockId === block.id && item.rotationId === rotation.id,
          );
          if (!variable) continue;
          const terms: [string, number][] = [[variable.name, prerequisite.blocks]];
          for (const earlier of project.blocks) {
            if (earlier.index >= block.index) break;
            const prior = assignments.find(
              (item) => item.residentId === resident.id && item.blockId === earlier.id && item.rotationId === prerequisite.rotationId,
            );
            if (prior) terms.push([prior.name, -1]);
          }
          lp.addConstraint(`pre_${variable.name}_${safeToken(prerequisite.rotationId)}`, terms, "<=", historical);
        }
      }
    }
  }

  for (const requirement of project.requirements) {
    for (const resident of project.residents) {
      if (!requirementApplies(requirement, resident)) continue;
      const progress = requirementProgress(project, resident, requirement);
      if (!progress || progress.mustScheduleNow <= 0) continue;
      const deadline = requirement.deadlineBlockId ? blockById(project, requirement.deadlineBlockId) : undefined;
      const terms: [string, number][] = [];
      for (const variable of assignments) {
        if (variable.residentId !== resident.id) continue;
        const block = blockById(project, variable.blockId);
        const rotation = rotationById(project, variable.rotationId);
        if (!block || !rotation) continue;
        if (deadline && block.index > deadline.index) continue;
        const credit = blockCredit(project, requirement, rotation);
        if (credit) terms.push([variable.name, credit]);
      }
      const already = waiverCredit(resident, requirement.id);
      const room = Math.max(0, requirement.maxRelaxation - already);
      if (allowSlack(options, requirement.id) && requirement.relaxable && requirement.priority > 0 && room > 0) {
        const name = `sreq_${safeToken(resident.id)}_${safeToken(requirement.id)}`;
        lp.addInteger(name, 0, room);
        terms.push([name, 1]);
        slacks.push({
          name,
          kind: "requirement",
          residentId: resident.id,
          requirementId: requirement.id,
          priority: requirement.priority,
        });
        addTerm(objectives.slackMagnitude, name, 1);
        if (requirement.priority <= 1) addTerm(objectives.highPrioritySlack, name, 1);
        const indicator = `aff_${safeToken(resident.id)}_${safeToken(requirement.id)}`;
        lp.addBinary(indicator);
        lp.addConstraint(`affc_${indicator}`, [[name, 1], [indicator, -room]], "<=", 0);
        addTerm(objectives.affectedResidents, indicator, 1);
      }
      lp.addConstraint(`req_${safeToken(resident.id)}_${safeToken(requirement.id)}`, terms, ">=", progress.mustScheduleNow);
    }
  }

  addCoupling(project, lp, assignments);

  const vacationId = vacationRotation(project)?.id;
  for (const variable of assignments) {
    const resident = residentsById.get(variable.residentId);
    const rotation = rotationById(project, variable.rotationId);
    const block = blockById(project, variable.blockId);
    if (!resident || !rotation || !block) continue;
    if (vacationId && rotation.id === vacationId) {
      const points = vacationChoicePoints(project.vacations, resident.id, block.id);
      if (points) addTerm(objectives.vacation, variable.name, -points);
    }
    const career = rotationPreferencePoints(resident, rotation, project.interests);
    if (career) addTerm(objectives.career, variable.name, -career);
    const current = project.assignments.find((item) => item.residentId === resident.id && item.blockId === block.id);
    if (current?.rotationId === rotation.id) {
      const weight = (project.blocks.length - block.index) * (isPastBlock(block, project.asOfDate) ? 5 : 1);
      addTerm(objectives.changes, variable.name, -weight);
    }
  }

  addFairness(project, lp, assignments, objectives.fairness);
  addSpacing(project, lp, assignments, objectives.spacing);

  const counts = lp.counts();
  return {
    lp,
    assignments,
    slacks,
    objectives,
    findings,
    fatal,
    stats: {
      ...counts,
      eliminatedAssignments: Math.max(0, possible - assignments.length),
      possibleAssignments: possible,
      warning: sizeWarning(counts.binaries),
    },
  };
}

function grantedMin(project: Project, blockId: string, rotationId: string): number {
  return project.staffingWaivers
    .filter((waiver) => waiver.blockId === blockId && waiver.rotationId === rotationId)
    .reduce((sum, waiver) => sum + waiver.minReduction, 0);
}

function grantedMax(project: Project, blockId: string, rotationId: string): number {
  return project.staffingWaivers
    .filter((waiver) => waiver.blockId === blockId && waiver.rotationId === rotationId)
    .reduce((sum, waiver) => sum + waiver.maxIncrease, 0);
}

function rotationHasConsecutive(project: Project): boolean {
  return project.rotations.some((rotation) => rotation.maxConsecutive != null);
}

function addCoupling(project: Project, lp: LpModel, assignments: AssignVar[]): void {
  for (const resident of project.residents) {
    const grouped = new Map<string, Requirement[]>();
    for (const requirement of project.requirements) {
      if (!requirementApplies(requirement, resident) || requirement.relaxable || requirement.deadlineBlockId) continue;
      const key = requirement.unit;
      grouped.set(key, [...(grouped.get(key) ?? []), requirement]);
    }
    for (const [unit, requirements] of grouped) {
      if (!disjoint(project, requirements)) continue;
      const unitPerBlock = unit === "weeks" ? project.blockWeeks : 1;
      const years = yearsAfterCurrent(project, resident);
      const futurePool = years * 13 * unitPerBlock;
      let immediate = 0;
      let deferrable = 0;
      const terms: [string, number][] = [];
      for (const requirement of requirements) {
        const remaining = Math.max(
          0,
          requirement.amount - historicalCredit(project, resident, requirement) - waiverCredit(resident, requirement.id),
        );
        if (years > 0 && futureCapacity(project, resident, requirement) > 0) deferrable += remaining;
        else immediate += remaining;
      }
      const mustNow = immediate + Math.max(0, deferrable - futurePool);
      if (mustNow <= 0) continue;
      for (const variable of assignments) {
        if (variable.residentId !== resident.id) continue;
        const rotation = rotationById(project, variable.rotationId);
        if (!rotation) continue;
        let credit = 0;
        for (const requirement of requirements) credit = Math.max(credit, blockCredit(project, requirement, rotation));
        if (credit) terms.push([variable.name, credit]);
      }
      lp.addConstraint(`cup_${safeToken(resident.id)}_${unit}`, terms, ">=", mustNow);
    }
  }
}

function disjoint(project: Project, requirements: Requirement[]): boolean {
  const seen = new Set<string>();
  for (const requirement of requirements) {
    for (const rotation of creditingRotations(project, requirement)) {
      if (seen.has(rotation.id)) return false;
      seen.add(rotation.id);
    }
  }
  return true;
}

function addFairness(project: Project, lp: LpModel, assignments: AssignVar[], target: LinearExpr): void {
  const cohorts = new Map<string, Resident[]>();
  for (const resident of project.residents) {
    const key = `${resident.pgy}|${resident.track}`;
    cohorts.set(key, [...(cohorts.get(key) ?? []), resident]);
  }
  const categories = ["icu", "nights", "wards", "holiday"] as const;
  for (const [key, members] of cohorts) {
    if (members.length < 2) continue;
    for (const category of categories) {
      const eligible = members.filter((resident) => category === "holiday" || eligibleForCategory(project, resident, category));
      if (eligible.length < 2) continue;
      const zName = `fair_${category}_${safeToken(key)}`;
      lp.addInteger(zName, 0, 200);
      addTerm(target, zName, 1);
      for (const resident of eligible) {
        const terms: [string, number][] = [[zName, 1]];
        for (const variable of assignments) {
          if (variable.residentId !== resident.id) continue;
          const rotation = rotationById(project, variable.rotationId);
          const block = blockById(project, variable.blockId);
          if (!rotation || !block) continue;
          if (countsFor(category, rotation, block.holiday)) terms.push([variable.name, -1]);
        }
        const historical = resident.historicalBurden[category === "nights" ? "nights" : category === "wards" ? "wards" : category === "icu" ? "icu" : "holiday"];
        const obligation = category === "holiday" ? 0 : obligationBlocks(project, resident, category);
        lp.addConstraint(`fairc_${zName}_${safeToken(resident.id)}`, terms, ">=", historical - obligation);
      }
    }
  }
}

function addSpacing(project: Project, lp: LpModel, assignments: AssignVar[], target: LinearExpr): void {
  for (const resident of project.residents) {
    for (let index = 0; index < project.blocks.length - 1; index += 1) {
      const name = `spc_${safeToken(resident.id)}_${index}`;
      const terms: [string, number][] = [[name, 1]];
      for (const offset of [0, 1]) {
        const block = project.blocks[index + offset];
        for (const variable of assignments) {
          if (variable.residentId !== resident.id || variable.blockId !== block.id) continue;
          const rotation = rotationById(project, variable.rotationId);
          if (rotation && rotation.workloadIntensity >= 4) terms.push([variable.name, -1]);
        }
      }
      if (terms.length === 1) continue;
      lp.addContinuous(name, 0, 1);
      addTerm(target, name, 1);
      lp.addConstraint(`spcc_${name}`, terms, ">=", -1);
    }
  }
}

function eligibleForCategory(project: Project, resident: Resident, category: "icu" | "nights" | "wards"): boolean {
  return project.rotations.some((rotation) => categoryOf(rotation) === category && project.blocks.some((block) => isEligible(project, resident, rotation, block)));
}

function categoryOf(rotation: Rotation): "icu" | "nights" | "wards" | null {
  if (rotation.category === "icu") return "icu";
  if (rotation.category === "night") return "nights";
  if (rotation.category === "ward") return "wards";
  return null;
}

function countsFor(category: "icu" | "nights" | "wards" | "holiday", rotation: Rotation, holiday: boolean): boolean {
  if (category === "holiday") return holiday && rotation.category !== "vacation";
  return categoryOf(rotation) === category;
}

function obligationBlocks(project: Project, resident: Resident, category: "icu" | "nights" | "wards"): number {
  let total = 0;
  for (const requirement of project.requirements) {
    const progress = requirementProgress(project, resident, requirement);
    if (!progress || progress.mustScheduleNow <= 0) continue;
    const rotations = creditingRotations(project, requirement);
    if (rotations.length === 0 || rotations.some((rotation) => categoryOf(rotation) !== category)) continue;
    const per = requirement.unit === "weeks" ? project.blockWeeks : 1;
    total += progress.mustScheduleNow / per;
  }
  return total;
}

export function describeSlack(project: Project, slack: SlackVar, amount: number): string {
  if (slack.kind === "requirement" && slack.residentId && slack.requirementId) {
    const resident = residentById(project, slack.residentId);
    const requirement = project.requirements.find((item) => item.id === slack.requirementId);
    return `${resident?.name ?? slack.residentId} receives a ${amount} ${requirement?.unit ?? "unit"} waiver on ${requirement?.name ?? slack.requirementId}.`;
  }
  const rotation = slack.rotationId ? rotationById(project, slack.rotationId) : undefined;
  const block = slack.blockId ? blockById(project, slack.blockId) : undefined;
  if (slack.kind === "staffing-min") {
    return `${rotation?.name ?? "Rotation"} minimum in ${block?.label ?? "a block"} is reduced by ${amount}.`;
  }
  return `${rotation?.name ?? "Rotation"} capacity in ${block?.label ?? "a block"} is increased by ${amount}.`;
}
