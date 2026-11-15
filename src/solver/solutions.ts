import type { Proposal } from "@/domain/types";

/** Validated schedules, best first. A duplicate of an earlier schedule is omitted. */
export function topSolutions(proposals: Proposal[]): Proposal[] {
  return proposals
    .filter((proposal) => proposal.validation.ok && !proposal.duplicateOf)
    .sort((left, right) => solutionRank(right) - solutionRank(left) || left.title.localeCompare(right.title));
}

function solutionRank(proposal: Proposal): number {
  const metrics = proposal.metrics;
  return (
    (proposal.provenOptimal ? 1000 : 0)
    - proposal.relaxations.length * 40
    - metrics.staffingShortfalls.length * 25
    - metrics.residentsBehind * 10
    - metrics.consecutiveIntensive * 5
    + metrics.vacationScore * 8
    + metrics.careerScore * 8
    - metrics.changedAssignments * 0.02
  );
}
