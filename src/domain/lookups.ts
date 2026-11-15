import type { AppliedRelaxation, Block, Project, Requirement, Resident, Rotation, VacationRequest } from "./types";

export function rotationById(project: Project, id: string): Rotation | undefined {
  return project.rotations.find((rotation) => rotation.id === id);
}

export function residentById(project: Project, id: string): Resident | undefined {
  return project.residents.find((resident) => resident.id === id);
}

export function blockById(project: Project, id: string): Block | undefined {
  return project.blocks.find((block) => block.id === id);
}

export function vacationRotation(project: Project): Rotation | undefined {
  return project.rotations.find((rotation) => rotation.category === "vacation");
}

export function requirementApplies(requirement: Requirement, resident: Resident): boolean {
  const rule = requirement.appliesTo;
  if (rule.residentIds && rule.residentIds.length > 0) return rule.residentIds.includes(resident.id);
  if (rule.all) return true;
  const pgyListed = (rule.pgy?.length ?? 0) > 0;
  const trackListed = (rule.tracks?.length ?? 0) > 0;
  if (!pgyListed && !trackListed) return false;
  const pgyOk = !pgyListed || rule.pgy!.includes(resident.pgy);
  const trackOk = !trackListed || rule.tracks!.includes(resident.track);
  return pgyOk && trackOk;
}

export function vacationCapacity(project: Project, blockId: string): number {
  if (project.vacationRules.blackoutBlockIds.includes(blockId)) return 0;
  const override = project.vacationRules.capacityByBlock.find((item) => item.blockId === blockId);
  return override?.capacity ?? project.vacationRules.defaultCapacity;
}

export function effectiveStaffing(
  project: Project,
  rotation: Rotation,
  blockId: string,
  extras: AppliedRelaxation[] = [],
): { min: number; max: number } {
  const base = staffingLimits(project, rotation, blockId);
  let min = base.min;
  let max = base.max;
  for (const waiver of project.staffingWaivers) {
    if (waiver.blockId !== blockId || waiver.rotationId !== rotation.id) continue;
    min -= waiver.minReduction;
    max += waiver.maxIncrease;
  }
  for (const extra of extras) {
    if (extra.blockId !== blockId || extra.rotationId !== rotation.id) continue;
    if (extra.kind === "staffing-min") min -= extra.amount;
    if (extra.kind === "staffing-max") max += extra.amount;
  }
  return { min: Math.max(0, min), max };
}

export function staffingLimits(
  project: Project,
  rotation: Rotation,
  blockId: string,
): { min: number; max: number } {
  if (rotation.category === "vacation") return { min: 0, max: vacationCapacity(project, blockId) };
  const cell = rotation.staffing.find((item) => item.blockId === blockId);
  return { min: cell?.min ?? 0, max: cell?.max ?? project.residents.length };
}

export function waiverCredit(resident: Resident, requirementId: string): number {
  return resident.waivers
    .filter((waiver) => waiver.requirementId === requirementId)
    .reduce((sum, waiver) => sum + waiver.amount, 0);
}

export function approvedVacation(project: Project, residentId: string, blockId: string): VacationRequest | undefined {
  return project.vacations.find(
    (vacation) => vacation.residentId === residentId && vacation.blockId === blockId && vacation.status === "approved",
  );
}

/** Credit earned by one covered block, in the requirement's unit. */
export function blockCredit(project: Project, requirement: Requirement, rotation: Rotation): number {
  const explicit = rotation.requirementCredits.find((credit) => credit.requirementId === requirement.id);
  if (explicit) return explicit.credits;
  if (!requirement.rotationIds.includes(rotation.id)) return 0;
  return requirement.unit === "weeks" ? project.blockWeeks : 1;
}

export function emptyBurden() {
  return { icu: 0, nights: 0, wards: 0, holiday: 0 };
}
