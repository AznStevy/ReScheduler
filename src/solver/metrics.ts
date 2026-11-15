import { effectiveStaffing, rotationById } from "@/domain/lookups";
import { rotationPreferencePoints, vacationChoicePoints, rankWeight } from "@/domain/preferences";
import { extraGrantFor, requirementProgress } from "@/domain/progress";
import type {
  AppliedRelaxation,
  Assignment,
  BurdenCategory,
  FairnessSpread,
  Project,
  ScheduleMetrics,
  StaffingGap,
} from "@/domain/types";

export function assignmentFingerprint(assignments: Assignment[]): string {
  return assignments
    .map((assignment) => `${assignment.residentId}|${assignment.blockId}|${assignment.rotationId}`)
    .sort()
    .join(";");
}

export function measureSchedule(
  project: Project,
  assignments: Assignment[],
  relaxations: AppliedRelaxation[] = [],
): ScheduleMetrics {
  const cell = (residentId: string, blockId: string) =>
    assignments.find((item) => item.residentId === residentId && item.blockId === blockId);
  let assignedCells = 0;
  const staffingShortfalls: StaffingGap[] = [];
  const staffingExcesses: StaffingGap[] = [];
  for (const rotation of project.rotations) {
    for (const block of project.blocks) {
      const have = assignments.filter((item) => item.rotationId === rotation.id && item.blockId === block.id).length;
      const limits = effectiveStaffing(project, rotation, block.id, relaxations);
      if (have < limits.min) staffingShortfalls.push({ blockId: block.id, rotationId: rotation.id, have, min: limits.min, max: limits.max });
      if (have > limits.max) staffingExcesses.push({ blockId: block.id, rotationId: rotation.id, have, min: limits.min, max: limits.max });
    }
  }
  const vacationRatios: number[] = [];
  let rank1Honored = 0;
  let rank1Residents = 0;
  const careerScores: number[] = [];
  let residentsBehind = 0;
  let consecutiveIntensive = 0;
  let changedAssignments = 0;

  for (const resident of project.residents) {
    let career = 0;
    let careerCells = 0;
    for (const block of project.blocks) {
      const assignment = cell(resident.id, block.id);
      const current = project.assignments.find((item) => item.residentId === resident.id && item.blockId === block.id);
      if ((assignment?.rotationId ?? null) !== (current?.rotationId ?? null)) changedAssignments += 1;
      if (!assignment) continue;
      assignedCells += 1;
      const rotation = rotationById(project, assignment.rotationId);
      if (!rotation) continue;
      career += rotationPreferencePoints(resident, rotation, project.interests) / 1000;
      careerCells += 1;
    }
    if (careerCells > 0) careerScores.push(career / careerCells);
    const pending = project.vacations.filter((vacation) => vacation.residentId === resident.id && vacation.status === "pending");
    if (pending.length > 0) {
      const weights = pending.map((vacation) => rankWeight(vacation.rank, pending.length));
      const denom = weights.reduce((sum, weight) => sum + weight, 0) || 1;
      let earned = 0;
      pending.forEach((vacation, index) => {
        const direct = cell(resident.id, vacation.blockId);
        const directRotation = direct ? rotationById(project, direct.rotationId) : undefined;
        if (directRotation?.category === "vacation") earned += weights[index];
        else if (
          vacation.alternatives.some((blockId) => {
            const alternative = cell(resident.id, blockId);
            return alternative ? rotationById(project, alternative.rotationId)?.category === "vacation" : false;
          })
        ) {
          earned += weights[index] / 2;
        }
      });
      vacationRatios.push(earned / denom);
      const top = [...pending].sort((a, b) => a.rank - b.rank)[0];
      rank1Residents += 1;
      const topAssignment = cell(resident.id, top.blockId);
      if (topAssignment && rotationById(project, topAssignment.rotationId)?.category === "vacation") rank1Honored += 1;
    }
    const behind = project.requirements.some((requirement) => {
      const progress = requirementProgress(
        project,
        resident,
        requirement,
        assignments,
        extraGrantFor(relaxations, resident.id, requirement.id),
      );
      return progress ? progress.scheduled + 1e-6 < progress.mustScheduleNow : false;
    });
    if (behind) residentsBehind += 1;
    for (let index = 0; index < project.blocks.length - 1; index += 1) {
      const left = cell(resident.id, project.blocks[index].id);
      const right = cell(resident.id, project.blocks[index + 1].id);
      const leftIntensity = left ? rotationById(project, left.rotationId)?.workloadIntensity ?? 0 : 0;
      const rightIntensity = right ? rotationById(project, right.rotationId)?.workloadIntensity ?? 0 : 0;
      if (leftIntensity >= 4 && rightIntensity >= 4) consecutiveIntensive += 1;
    }
  }

  return {
    assignedCells,
    openCells: project.residents.length * project.blocks.length - assignedCells,
    staffingShortfalls,
    staffingExcesses,
    vacationScore: average(vacationRatios, 1),
    vacationRank1Rate: rank1Residents === 0 ? 1 : rank1Honored / rank1Residents,
    fairnessSpread: fairness(project, assignments),
    careerScore: average(careerScores, 0),
    residentsBehind,
    changedAssignments,
    consecutiveIntensive,
    relaxationCount: relaxations.length,
  };
}

function fairness(project: Project, assignments: Assignment[]): FairnessSpread[] {
  const cohorts = new Map<string, typeof project.residents>();
  for (const resident of project.residents) {
    const key = `${resident.pgy}|${resident.track}`;
    cohorts.set(key, [...(cohorts.get(key) ?? []), resident]);
  }
  const spreads: FairnessSpread[] = [];
  const categories: BurdenCategory[] = ["icu", "nights", "wards", "holiday"];
  for (const [key, members] of cohorts) {
    if (members.length < 2) continue;
    const [pgy, track] = key.split("|");
    for (const category of categories) {
      const burdens = members.map((resident) => burden(project, assignments, resident.id, category) + resident.historicalBurden[category === "nights" ? "nights" : category]);
      spreads.push({
        pgy: Number(pgy),
        track,
        category,
        min: Math.min(...burdens),
        max: Math.max(...burdens),
      });
    }
  }
  return spreads;
}

function burden(project: Project, assignments: Assignment[], residentId: string, category: BurdenCategory): number {
  let total = 0;
  for (const assignment of assignments) {
    if (assignment.residentId !== residentId) continue;
    const rotation = rotationById(project, assignment.rotationId);
    const block = project.blocks.find((item) => item.id === assignment.blockId);
    if (!rotation || !block) continue;
    if (category === "holiday" && block.holiday && rotation.category !== "vacation") total += 1;
    if (category === "icu" && rotation.category === "icu") total += 1;
    if (category === "nights" && rotation.category === "night") total += 1;
    if (category === "wards" && rotation.category === "ward") total += 1;
  }
  return total;
}

function average(values: number[], empty: number): number {
  if (values.length === 0) return empty;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function impactLines(_project: Project, metrics: ScheduleMetrics, relaxations: AppliedRelaxation[]): string[] {
  const lines = relaxations.map((relaxation) => relaxation.description);
  if (metrics.staffingShortfalls.length === 0) lines.push("Staffing minimums are met under the listed relaxations.");
  else lines.push(`${metrics.staffingShortfalls.length} staffing minimums are still short.`);
  lines.push(`Rank-1 vacation requests honored: ${percent(metrics.vacationRank1Rate)}.`);
  lines.push(`Career-interest alignment: ${percent(metrics.careerScore)}.`);
  lines.push(`Residents behind a required training target: ${metrics.residentsBehind}.`);
  lines.push(`Assignments different from the current schedule: ${metrics.changedAssignments}.`);
  lines.push(`Consecutive intensive pairs: ${metrics.consecutiveIntensive}.`);
  const widest = metrics.fairnessSpread.reduce<{ category: string; gap: number } | null>((best, spread) => {
    const gap = spread.max - spread.min;
    if (!best || gap > best.gap) return { category: spread.category, gap };
    return best;
  }, null);
  if (widest) lines.push(`Widest cohort burden gap is ${widest.gap} ${widest.category} block(s).`);
  return lines;
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function vacationPointsOf(project: Project, residentId: string, blockId: string): number {
  return vacationChoicePoints(project.vacations, residentId, blockId);
}
