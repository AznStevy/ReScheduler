import { canStart, forcedChoice, isEligible } from "@/domain/eligibility";
import { blockCredit, rotationById, staffingLimits, vacationCapacity, vacationRotation } from "@/domain/lookups";
import { creditingRotations, requirementProgress } from "@/domain/progress";
import type { ConflictFinding, Project, Requirement, Resident } from "@/domain/types";

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

export function diagnose(project: Project): ConflictFinding[] {
  const findings: ConflictFinding[] = [];
  findings.push(...staffingFindings(project), ...lockFindings(project), ...vacationFindings(project), ...requirementFindings(project));
  return findings;
}

function staffingFindings(project: Project): ConflictFinding[] {
  const findings: ConflictFinding[] = [];
  for (const block of project.blocks) {
    let minSum = 0;
    let maxSum = 0;
    let minSlack = 0;
    let maxSlack = 0;
    for (const rotation of project.rotations) {
      const limits = staffingLimits(project, rotation, block.id);
      minSum += limits.min;
      maxSum += limits.max;
      if (rotation.staffingPriority > 0) {
        minSlack += rotation.relaxStaffingMin;
        maxSlack += rotation.relaxStaffingMax;
      }
    }
    const residents = project.residents.length;
    if (minSum - minSlack > residents) {
      findings.push(
        finding(
          `staff-total-${block.id}`,
          "immutable",
          `${block.label} asks for more staffed seats than there are residents`,
          `Minimum staffing totals ${minSum}. Even the authorized reductions of ${minSlack} leave more required seats than the ${residents} residents.`,
          { blockIds: [block.id] },
        ),
      );
    } else if (minSum > residents) {
      findings.push(
        finding(
          `staff-total-${block.id}`,
          "relaxable",
          `${block.label} minimum staffing exceeds the number of residents`,
          `Minimum staffing totals ${minSum} and only ${residents} residents are in the program. Authorized staffing reductions total ${minSlack}.`,
          { blockIds: [block.id] },
        ),
      );
    }
    if (maxSum + maxSlack < residents) {
      findings.push(
        finding(
          `staff-capacity-${block.id}`,
          "immutable",
          `${block.label} does not have enough rotation capacity`,
          `The maximum seats, including authorized capacity increases, total ${maxSum + maxSlack}. That cannot hold ${residents} residents.`,
          { blockIds: [block.id] },
        ),
      );
    } else if (maxSum < residents) {
      findings.push(
        finding(
          `staff-capacity-${block.id}`,
          "relaxable",
          `${block.label} rotation capacity is short`,
          `Maximum seats total ${maxSum} before using authorized increases of ${maxSlack}.`,
          { blockIds: [block.id] },
        ),
      );
    }
    for (const rotation of project.rotations) {
      const limits = staffingLimits(project, rotation, block.id);
      if (limits.min <= 0) continue;
      const available = project.residents.filter((resident) => residentCanFill(project, resident, rotation.id, block.id)).length;
      const room = rotation.staffingPriority > 0 ? rotation.relaxStaffingMin : 0;
      if (limits.min - room > available) {
        findings.push(
          finding(
            `staff-supply-${block.id}-${rotation.id}`,
            "immutable",
            `${block.label} needs ${limits.min} ${rotation.name} residents, and only ${available} can be assigned`,
            "Eligibility, locks, and approved leave leave too few residents. This staffing minimum is not authorized for enough relaxation.",
            { blockIds: [block.id], rotationIds: [rotation.id] },
          ),
        );
      } else if (limits.min > available) {
        findings.push(
          finding(
            `staff-supply-${block.id}-${rotation.id}`,
            "relaxable",
            `${block.label} needs ${limits.min} ${rotation.name} residents, but only ${available} are available`,
            `The rotation allows the minimum to be reduced by ${room}. This check is structural and is not claimed to be a minimal conflict set.`,
            { blockIds: [block.id], rotationIds: [rotation.id] },
          ),
        );
      }
    }
  }
  return findings;
}

function residentCanFill(project: Project, resident: Resident, rotationId: string, blockId: string): boolean {
  const block = project.blocks.find((item) => item.id === blockId);
  const rotation = rotationById(project, rotationId);
  if (!block || !rotation) return false;
  const forced = forcedChoice(project, resident, blockId);
  if (forced.conflict) return false;
  if (forced.rotationId) return forced.rotationId === rotationId;
  if (rotation.durationBlocks > 1) return canStart(project, resident, rotation, block);
  return isEligible(project, resident, rotation, block);
}

function lockFindings(project: Project): ConflictFinding[] {
  const findings: ConflictFinding[] = [];
  for (const resident of project.residents) {
    for (const block of project.blocks) {
      const forced = forcedChoice(project, resident, block.id);
      if (forced.conflict) {
        findings.push(
          finding(
            `lock-conflict-${resident.id}-${block.id}`,
            "immutable",
            `${resident.name} has conflicting locked assignments in ${block.label}`,
            `Those locks come from ${forced.sources.join(" and ")}. Approved protected leave is not removed automatically.`,
            { residentIds: [resident.id], blockIds: [block.id] },
          ),
        );
        continue;
      }
      if (!forced.rotationId) continue;
      const rotation = rotationById(project, forced.rotationId);
      if (!rotation || !isEligible(project, resident, rotation, block)) {
        findings.push(
          finding(
            `lock-ineligible-${resident.id}-${block.id}`,
            "immutable",
            `${resident.name} is locked to an ineligible rotation in ${block.label}`,
            rotation
              ? `${rotation.name} is not eligible here, so the lock cannot be honored by any schedule.`
              : "The locked rotation does not exist.",
            { residentIds: [resident.id], blockIds: [block.id], rotationIds: rotation ? [rotation.id] : [] },
          ),
        );
      }
    }
  }
  return findings;
}

function vacationFindings(project: Project): ConflictFinding[] {
  const findings: ConflictFinding[] = [];
  for (const block of project.blocks) {
    const approved = project.vacations.filter((vacation) => vacation.blockId === block.id && vacation.status === "approved");
    const capacity = vacationCapacity(project, block.id);
    if (approved.length > capacity) {
      findings.push(
        finding(
          `vacation-capacity-${block.id}`,
          "immutable",
          `${approved.length} residents have approved leave in ${block.label}, above capacity ${capacity}`,
          "Approved protected leave cannot be removed automatically, and vacation capacity is not an authorized relaxation.",
          { blockIds: [block.id], residentIds: approved.map((vacation) => vacation.residentId) },
        ),
      );
    }
    if (project.vacationRules.blackoutBlockIds.includes(block.id) && approved.length > 0) {
      findings.push(
        finding(
          `blackout-${block.id}`,
          "immutable",
          `${block.label} is a vacation blackout with approved leave`,
          "Approved leave cannot be placed in a blackout block without editing one of those immutable inputs.",
          { blockIds: [block.id], residentIds: approved.map((vacation) => vacation.residentId) },
        ),
      );
    }
    const pending = project.vacations.filter((vacation) => vacation.blockId === block.id && vacation.status === "pending");
    if (approved.length + pending.length > capacity) {
      findings.push(
        finding(
          `vacation-pressure-${block.id}`,
          "info",
          `${block.label} has more vacation requests than capacity`,
          `${approved.length} approved and ${pending.length} pending requests compete for ${capacity} vacation seats. Pending requests can move. Approved leave stays.`,
          { blockIds: [block.id] },
        ),
      );
    }
  }
  if (!vacationRotation(project) && project.vacations.some((vacation) => vacation.status === "approved")) {
    findings.push(
      finding(
        "vacation-rotation-missing",
        "immutable",
        "Approved leave has no vacation rotation",
        "Add a rotation with category Vacation before protected leave can be scheduled.",
      ),
    );
  }
  return findings;
}

function requirementFindings(project: Project): ConflictFinding[] {
  const findings: ConflictFinding[] = [];
  for (const resident of project.residents) {
    for (const requirement of project.requirements) {
      const progress = requirementProgress(project, resident, requirement);
      if (!progress || progress.mustScheduleNow <= 0) continue;
      const upper = creditUpperBound(project, resident, requirement);
      const room = requirement.relaxable && requirement.priority > 0 ? Math.max(0, requirement.maxRelaxation) : 0;
      if (progress.mustScheduleNow > upper + room) {
        findings.push(
          finding(
            `requirement-${resident.id}-${requirement.id}`,
            "immutable",
            `${resident.name} cannot finish ${requirement.name}`,
            `${progress.mustScheduleNow} ${requirement.unit} are still required in the blocks that remain, and at most ${upper} can be earned. This requirement is not authorized for enough relaxation.`,
            { residentIds: [resident.id], requirementIds: [requirement.id] },
          ),
        );
      } else if (progress.mustScheduleNow > upper) {
        findings.push(
          finding(
            `requirement-${resident.id}-${requirement.id}`,
            "relaxable",
            `${resident.name} is short on ${requirement.name}`,
            `${progress.mustScheduleNow} ${requirement.unit} are required now and about ${upper} can be scheduled. A waiver of up to ${room} is authorized. This is a structural estimate, not a proved minimal conflict.`,
            { residentIds: [resident.id], requirementIds: [requirement.id] },
          ),
        );
      }
    }
  }
  return findings;
}

export function creditUpperBound(project: Project, resident: Resident, requirement: Requirement): number {
  const rotations = creditingRotations(project, requirement);
  const deadline = requirement.deadlineBlockId
    ? project.blocks.find((block) => block.id === requirement.deadlineBlockId)
    : undefined;
  let perBlock = 0;
  const capCredit = new Map<string, number>();
  for (const rotation of rotations) {
    const credit = blockCredit(project, requirement, rotation);
    const eligible = project.blocks.filter((block) => {
      if (deadline && block.index > deadline.index) return false;
      const forced = forcedChoice(project, resident, block.id);
      if (forced.rotationId === rotation.id) return true;
      if (forced.rotationId || forced.conflict) return false;
      return rotation.durationBlocks > 1 ? canStart(project, resident, rotation, block) : isEligible(project, resident, rotation, block);
    }).length;
    const limited = rotation.maxBlocksPerResident == null ? eligible : Math.min(eligible, rotation.maxBlocksPerResident);
    capCredit.set(rotation.id, limited * credit);
  }
  for (const block of project.blocks) {
    if (deadline && block.index > deadline.index) continue;
    const forced = forcedChoice(project, resident, block.id);
    if (forced.conflict) continue;
    if (forced.rotationId) {
      const rotation = rotationById(project, forced.rotationId);
      if (rotation) perBlock += blockCredit(project, requirement, rotation);
      continue;
    }
    let best = 0;
    for (const rotation of rotations) {
      const eligible = rotation.durationBlocks > 1 ? canStart(project, resident, rotation, block) : isEligible(project, resident, rotation, block);
      if (!eligible) continue;
      best = Math.max(best, blockCredit(project, requirement, rotation));
    }
    perBlock += best;
  }
  const capSum = [...capCredit.values()].reduce((sum, value) => sum + value, 0);
  return Math.min(perBlock, capSum);
}
