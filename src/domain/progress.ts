import { academicStartYear } from "./calendar";
import { blockCredit, requirementApplies, rotationById, waiverCredit } from "./lookups";
import type { Project, Requirement, Resident, Rotation } from "./types";

export interface RequirementProgress {
  requirement: Requirement;
  historical: number;
  granted: number;
  scheduled: number;
  required: number;
  futureCapacity: number;
  mustScheduleNow: number;
  remainingToGraduate: number;
}

export function yearsAfterCurrent(project: Project, resident: Resident): number {
  const first = project.blocks[0];
  if (!first) return 0;
  return Math.max(0, academicStartYear(resident.graduationDate) - academicStartYear(first.startDate));
}

export function creditingRotations(project: Project, requirement: Requirement): Rotation[] {
  return project.rotations.filter((rotation) => blockCredit(project, requirement, rotation) > 0);
}

export function historicalCredit(project: Project, resident: Resident, requirement: Requirement): number {
  let total = 0;
  for (const previous of resident.previousRotations) {
    const rotation = rotationById(project, previous.rotationId);
    if (!rotation) continue;
    total += blockCredit(project, requirement, rotation) * previous.blocks;
  }
  return total;
}

function eligibleLater(resident: Resident, rotations: Rotation[]): boolean {
  return rotations.some((rotation) => rotation.eligiblePgy.some((pgy) => pgy > resident.pgy));
}

export function futureCapacity(project: Project, resident: Resident, requirement: Requirement): number {
  if (requirement.deadlineBlockId) return 0;
  const years = yearsAfterCurrent(project, resident);
  if (years <= 0) return 0;
  const rotations = creditingRotations(project, requirement);
  if (!eligibleLater(resident, rotations)) return 0;
  const unitPerBlock = requirement.unit === "weeks" ? project.blockWeeks : 1;
  const perYear = requirement.maxPerYear ?? 13 * unitPerBlock;
  return years * perYear;
}

export function scheduledCredit(
  project: Project,
  resident: Resident,
  requirement: Requirement,
  assignments: { residentId: string; blockId: string; rotationId: string }[],
): number {
  const deadline = requirement.deadlineBlockId
    ? project.blocks.find((block) => block.id === requirement.deadlineBlockId)
    : undefined;
  let total = 0;
  for (const assignment of assignments) {
    if (assignment.residentId !== resident.id) continue;
    const block = project.blocks.find((item) => item.id === assignment.blockId);
    const rotation = rotationById(project, assignment.rotationId);
    if (!block || !rotation) continue;
    if (deadline && block.index > deadline.index) continue;
    total += blockCredit(project, requirement, rotation);
  }
  return total;
}

export function requirementProgress(
  project: Project,
  resident: Resident,
  requirement: Requirement,
  assignments: { residentId: string; blockId: string; rotationId: string }[] = [],
  extraGrant = 0,
): RequirementProgress | null {
  if (!requirementApplies(requirement, resident)) return null;
  const historical = historicalCredit(project, resident, requirement);
  const granted = waiverCredit(resident, requirement.id) + extraGrant;
  const scheduled = scheduledCredit(project, resident, requirement, assignments);
  const future = futureCapacity(project, resident, requirement);
  const remainingToGraduate = Math.max(0, requirement.amount - historical - granted - scheduled);
  const remainingBeforeSchedule = Math.max(0, requirement.amount - historical - granted);
  const mustScheduleNow = Math.max(0, remainingBeforeSchedule - Math.min(future, remainingBeforeSchedule));
  return {
    requirement,
    historical,
    granted,
    scheduled,
    required: requirement.amount,
    futureCapacity: future,
    mustScheduleNow,
    remainingToGraduate,
  };
}

export function residentProgress(project: Project, resident: Resident, assignments = project.assignments) {
  return project.requirements
    .map((requirement) => requirementProgress(project, resident, requirement, assignments))
    .filter((item): item is RequirementProgress => item !== null);
}

export function extraGrantFor(
  relaxations: { kind: string; residentId?: string; requirementId?: string; amount: number }[],
  residentId: string,
  requirementId: string,
): number {
  return relaxations
    .filter((item) => item.kind === "requirement" && item.residentId === residentId && item.requirementId === requirementId)
    .reduce((sum, item) => sum + item.amount, 0);
}
