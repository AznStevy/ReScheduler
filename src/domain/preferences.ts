import { careerMatchScore } from "./career";
import type { CareerInterest, Resident, Rotation, VacationRequest } from "./types";

/** Top choice is worth 1000 for every resident. Extra preferences cannot raise that cap. */
export function rankWeight(rank: number, total: number): number {
  if (total <= 0 || rank <= 0) return 0;
  return Math.round((1000 * (total - rank + 1)) / total);
}

export function rotationPreferencePoints(resident: Resident, rotation: Rotation, catalog: CareerInterest[] = []): number {
  let best = 0;
  const interests = [...resident.careerInterests].sort((a, b) => a.rank - b.rank);
  for (const interest of interests) {
    const name = catalog.find((item) => item.id === interest.interestId)?.name ?? interest.interestId.replace(/-/g, " ");
    const score = careerMatchScore(interest.interestId, name, rotation);
    if (!score) continue;
    const points = Math.round((score / 100) * rankWeight(interest.rank, interests.length));
    best = Math.max(best, points);
  }
  const electives = [...resident.electivePreferences].sort((a, b) => a.rank - b.rank);
  const elective = electives.find((item) => item.rotationId === rotation.id);
  if (elective) best = Math.max(best, rankWeight(elective.rank, electives.length));
  return Math.min(1000, best);
}

export function vacationChoicePoints(vacations: VacationRequest[], residentId: string, blockId: string): number {
  const pending = vacations.filter((vacation) => vacation.residentId === residentId && vacation.status === "pending");
  const direct = pending.find((vacation) => vacation.blockId === blockId);
  if (direct) return rankWeight(direct.rank, pending.length);
  let best = 0;
  for (const vacation of pending) {
    if (!vacation.alternatives.includes(blockId)) continue;
    best = Math.max(best, Math.round(rankWeight(vacation.rank, pending.length) / 2));
  }
  return best;
}
