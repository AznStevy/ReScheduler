import { eligibilityReasons, forcedChoice, isEligible } from "@/domain/eligibility";
import { effectiveStaffing, requirementApplies, rotationById } from "@/domain/lookups";
import { extraGrantFor, requirementProgress } from "@/domain/progress";
import type { AppliedRelaxation, Assignment, Project, Rotation, ValidationIssue, ValidationReport } from "@/domain/types";

export interface ValidationOptions {
  requireComplete?: boolean;
  relaxations?: AppliedRelaxation[];
}

export function validateSchedule(project: Project, assignments: Assignment[], options: ValidationOptions = {}): ValidationReport {
  const issues: ValidationIssue[] = [];
  const relaxations = options.relaxations ?? [];
  const byCell = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    const key = `${assignment.residentId}|${assignment.blockId}`;
    byCell.set(key, [...(byCell.get(key) ?? []), assignment]);
  }

  for (const resident of project.residents) {
    const ordered = project.blocks.flatMap((block) => byCell.get(`${resident.id}|${block.id}`) ?? []);
    for (const block of project.blocks) {
      const cell = byCell.get(`${resident.id}|${block.id}`) ?? [];
      if (cell.length > 1) {
        issues.push({
          code: "duplicate",
          message: `${resident.name} has more than one rotation in ${block.label}.`,
          residentId: resident.id,
          blockId: block.id,
        });
      }
      if (cell.length === 0 && options.requireComplete) {
        issues.push({
          code: "missing",
          message: `${resident.name} is unassigned in ${block.label}.`,
          residentId: resident.id,
          blockId: block.id,
        });
      }
      const assignment = cell[0];
      const forced = forcedChoice(project, resident, block.id);
      if (assignment && forced.rotationId && assignment.rotationId !== forced.rotationId) {
        issues.push({
          code: forced.sources.includes("approved protected leave") ? "protected-leave" : "lock",
          message: `${resident.name} must remain on the locked rotation in ${block.label}.`,
          residentId: resident.id,
          blockId: block.id,
          rotationId: forced.rotationId,
        });
      }
      if (!assignment && forced.rotationId && (options.requireComplete || forced.sources.includes("approved protected leave"))) {
        issues.push({
          code: forced.sources.includes("approved protected leave") ? "protected-leave" : "lock",
          message: `${resident.name} is missing a required locked assignment in ${block.label}.`,
          residentId: resident.id,
          blockId: block.id,
          rotationId: forced.rotationId,
        });
      }
      if (!assignment) continue;
      const rotation = rotationById(project, assignment.rotationId);
      if (!rotation || !isEligible(project, resident, rotation, block)) {
        const reasons = rotation ? eligibilityReasons(project, resident, rotation, block) : ["That rotation is not in the program."];
        issues.push({
          code: "ineligible",
          message: `${resident.name} is not eligible for ${rotation?.name ?? "the assigned rotation"} in ${block.label}.${reasons.length ? ` ${reasons.join(" ")}` : ""}`,
          residentId: resident.id,
          blockId: block.id,
          rotationId: assignment.rotationId,
        });
      }
    }
    issues.push(...durationIssues(project, resident.id, resident.name, ordered));
    issues.push(...prerequisiteIssues(project, resident.id, resident.name, ordered));
  }

  for (const rotation of project.rotations) {
    for (const block of project.blocks) {
      const have = assignments.filter((item) => item.rotationId === rotation.id && item.blockId === block.id).length;
      const limits = effectiveStaffing(project, rotation, block.id, relaxations);
      if (have < limits.min) {
        issues.push({
          code: "staffing-min",
          message: `${block.label} ${rotation.name} has ${have} residents and needs at least ${limits.min}.`,
          blockId: block.id,
          rotationId: rotation.id,
        });
      }
      if (have > limits.max) {
        issues.push({
          code: "staffing-max",
          message: `${block.label} ${rotation.name} has ${have} residents and allows at most ${limits.max}.`,
          blockId: block.id,
          rotationId: rotation.id,
        });
      }
    }
    if (rotation.maxBlocksPerResident != null) {
      for (const resident of project.residents) {
        const count = assignments.filter((item) => item.residentId === resident.id && item.rotationId === rotation.id).length;
        if (count > rotation.maxBlocksPerResident) {
          issues.push({
            code: "annual-cap",
            message: `${resident.name} is assigned ${rotation.name} ${count} times, above the cap of ${rotation.maxBlocksPerResident}.`,
            residentId: resident.id,
            rotationId: rotation.id,
          });
        }
      }
    }
  }

  for (const resident of project.residents) {
    for (let index = 0; index < project.blocks.length - 1; index += 1) {
      const left = assignmentAt(assignments, resident.id, project.blocks[index].id);
      const right = assignmentAt(assignments, resident.id, project.blocks[index + 1].id);
      if (!left || !right) continue;
      const leftRotation = rotationById(project, left.rotationId);
      const rightRotation = rotationById(project, right.rotationId);
      if (!leftRotation || !rightRotation) continue;
      if (
        leftRotation.noConsecutiveCategories.includes(rightRotation.category) ||
        rightRotation.noConsecutiveCategories.includes(leftRotation.category)
      ) {
        issues.push({
          code: "category-adjacency",
          message: `${resident.name} has ${leftRotation.name} next to ${rightRotation.name}.`,
          residentId: resident.id,
          blockId: project.blocks[index].id,
        });
      }
      if (leftRotation.maxConsecutive != null && leftRotation.id === rightRotation.id) {
        const run = runLength(project, assignments, resident.id, index, leftRotation.id);
        if (run > leftRotation.maxConsecutive && index === runStart(project, assignments, resident.id, index, leftRotation.id)) {
          issues.push({
            code: "consecutive",
            message: `${resident.name} has ${run} consecutive ${leftRotation.name} blocks, above the cap of ${leftRotation.maxConsecutive}.`,
            residentId: resident.id,
            blockId: project.blocks[index].id,
            rotationId: leftRotation.id,
          });
        }
      }
    }
    for (const requirement of project.requirements) {
      if (!requirementApplies(requirement, resident)) continue;
      const progress = requirementProgress(
        project,
        resident,
        requirement,
        assignments,
        extraGrantFor(relaxations, resident.id, requirement.id),
      );
      if (progress && progress.scheduled + 1e-6 < progress.mustScheduleNow) {
        issues.push({
          code: "requirement",
          message: `${resident.name} has ${formatAmount(progress.scheduled)} of ${formatAmount(progress.mustScheduleNow)} required ${requirement.unit} for ${requirement.name}.`,
          residentId: resident.id,
          requirementId: requirement.id,
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

function assignmentAt(assignments: Assignment[], residentId: string, blockId: string): Assignment | undefined {
  return assignments.find((item) => item.residentId === residentId && item.blockId === blockId);
}

function durationIssues(project: Project, residentId: string, name: string, ordered: Assignment[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let index = 0;
  const byBlock = new Map(ordered.map((item) => [item.blockId, item]));
  while (index < project.blocks.length) {
    const assignment = byBlock.get(project.blocks[index].id);
    if (!assignment) {
      index += 1;
      continue;
    }
    const rotation = rotationById(project, assignment.rotationId);
    if (!rotation || rotation.durationBlocks <= 1) {
      index += 1;
      continue;
    }
    let length = 1;
    while (
      index + length < project.blocks.length &&
      byBlock.get(project.blocks[index + length].id)?.rotationId === rotation.id
    ) {
      length += 1;
    }
    if (length % rotation.durationBlocks !== 0) {
      issues.push({
        code: "duration",
        message: `${name} has a ${length}-block run of ${rotation.name}, which must be scheduled in multiples of ${rotation.durationBlocks}.`,
        residentId,
        blockId: project.blocks[index].id,
        rotationId: rotation.id,
      });
    }
    index += length;
  }
  return issues;
}

function prerequisiteIssues(project: Project, residentId: string, name: string, ordered: Assignment[]): ValidationIssue[] {
  const resident = project.residents.find((item) => item.id === residentId);
  if (!resident) return [];
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const block of project.blocks) {
    const assignment = ordered.find((item) => item.blockId === block.id);
    if (!assignment) continue;
    const rotation = rotationById(project, assignment.rotationId);
    if (!rotation) continue;
    const runKey = `${rotation.id}:${runStartIndex(project, ordered, block.index, rotation.id)}`;
    if (seen.has(runKey)) continue;
    seen.add(runKey);
    for (const prerequisite of rotation.prerequisites) {
      const historical = resident.previousRotations.find((item) => item.rotationId === prerequisite.rotationId)?.blocks ?? 0;
      const earlier = ordered.filter((item) => {
        const prior = project.blocks.find((candidate) => candidate.id === item.blockId);
        return item.rotationId === prerequisite.rotationId && prior && prior.index < block.index;
      }).length;
      if (historical + earlier < prerequisite.blocks) {
        issues.push({
          code: "prerequisite",
          message: `${name} starts ${rotation.name} in ${block.label} before completing ${prerequisite.blocks} block(s) of the prerequisite.`,
          residentId,
          blockId: block.id,
          rotationId: rotation.id,
        });
      }
    }
  }
  return issues;
}

function runStartIndex(project: Project, ordered: Assignment[], index: number, rotationId: string): number {
  let cursor = index;
  while (cursor > 0) {
    const previous = ordered.find((item) => item.blockId === project.blocks[cursor - 1].id);
    if (previous?.rotationId !== rotationId) break;
    cursor -= 1;
  }
  return cursor;
}

function runLength(project: Project, assignments: Assignment[], residentId: string, index: number, rotationId: string): number {
  const start = runStart(project, assignments, residentId, index, rotationId);
  let length = 0;
  for (let cursor = start; cursor < project.blocks.length; cursor += 1) {
    const assignment = assignmentAt(assignments, residentId, project.blocks[cursor].id);
    if (assignment?.rotationId !== rotationId) break;
    length += 1;
  }
  return length;
}

function runStart(project: Project, assignments: Assignment[], residentId: string, index: number, rotationId: string): number {
  let cursor = index;
  while (cursor > 0) {
    const previous = assignmentAt(assignments, residentId, project.blocks[cursor - 1].id);
    if (previous?.rotationId !== rotationId) break;
    cursor -= 1;
  }
  return cursor;
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

export function rotationIntensity(rotation: Rotation | undefined): number {
  return rotation?.workloadIntensity ?? 0;
}
