import { vacationRotation } from "./lookups";
import type { Block, Project, Resident, Rotation } from "./types";

export function isEligible(project: Project, resident: Resident, rotation: Rotation, block: Block): boolean {
  return eligibilityReasons(project, resident, rotation, block).length === 0;
}

export function eligibilityReasons(project: Project, resident: Resident, rotation: Rotation, block: Block): string[] {
  const reasons: string[] = [];
  if (!rotation.eligiblePgy.includes(resident.pgy)) {
    reasons.push(rotation.eligiblePgy.length ? `PGY-${resident.pgy} is outside ${yearList(rotation.eligiblePgy)}.` : "No training year can take this rotation.");
  }
  if (rotation.eligibleTracks.length > 0 && !rotation.eligibleTracks.includes(resident.track)) {
    reasons.push(`${resident.track} is outside ${rotation.eligibleTracks.join(", ")}.`);
  }
  if (resident.restrictions.includes(rotation.id)) reasons.push("This resident is restricted from this rotation.");
  if (rotation.availableBlocks.length > 0 && !rotation.availableBlocks.includes(block.id)) reasons.push("This rotation is not offered in this block.");
  if (rotation.category === "vacation" && project.vacationRules.blackoutBlockIds.includes(block.id)) reasons.push("Vacation is blocked in this block.");
  return reasons;
}

function yearList(years: number[]): string {
  const sorted = [...years].sort((left, right) => left - right);
  const contiguous = sorted.every((year, index) => index === 0 || year === sorted[index - 1] + 1);
  if (sorted.length === 1) return `PGY-${sorted[0]}`;
  if (contiguous) return `PGY-${sorted[0]}–PGY-${sorted[sorted.length - 1]}`;
  return sorted.map((year) => `PGY-${year}`).join(", ");
}

export interface ForcedChoice {
  rotationId: string | null;
  sources: string[];
  conflict: boolean;
}

export function forcedChoice(project: Project, resident: Resident, blockId: string): ForcedChoice {
  const choices = new Map<string, string[]>();
  const add = (rotationId: string, source: string) => {
    const sources = choices.get(rotationId) ?? [];
    if (!sources.includes(source)) sources.push(source);
    choices.set(rotationId, sources);
  };
  const block = project.blocks.find((item) => item.id === blockId);
  if (block?.locked) {
    const current = project.assignments.find((item) => item.residentId === resident.id && item.blockId === blockId);
    if (current) add(current.rotationId, "locked block");
  }
  if (resident.locked) {
    const current = project.assignments.find((item) => item.residentId === resident.id && item.blockId === blockId);
    if (current) add(current.rotationId, "locked resident");
  }
  for (const lock of resident.lockedAssignments) {
    if (lock.blockId === blockId) add(lock.rotationId, "resident lock");
  }
  for (const assignment of project.assignments) {
    if (assignment.residentId === resident.id && assignment.blockId === blockId && assignment.locked) {
      add(assignment.rotationId, "locked schedule cell");
    }
  }
  const vacation = project.vacations.find(
    (item) => item.residentId === resident.id && item.blockId === blockId && item.status === "approved",
  );
  if (vacation) {
    const vacationId = vacationRotation(project)?.id;
    if (vacationId) add(vacationId, "approved protected leave");
    else add("__missing_vacation_rotation__", "approved protected leave");
  }
  const ids = [...choices.keys()];
  const sources = ids.flatMap((id) => choices.get(id) ?? []);
  if (ids.length > 1) return { rotationId: null, sources, conflict: true };
  if (ids.length === 1) return { rotationId: ids[0], sources, conflict: false };
  return { rotationId: null, sources: [], conflict: false };
}

export function canStart(
  project: Project,
  resident: Resident,
  rotation: Rotation,
  start: Block,
): boolean {
  const duration = Math.max(1, rotation.durationBlocks);
  for (let offset = 0; offset < duration; offset += 1) {
    const block = project.blocks[start.index + offset];
    if (!block) return false;
    if (!isEligible(project, resident, rotation, block)) return false;
    const forced = forcedChoice(project, resident, block.id);
    if (forced.conflict) return false;
    if (forced.rotationId && forced.rotationId !== rotation.id) return false;
  }
  return true;
}
