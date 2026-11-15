import { forcedChoice, isEligible } from "@/domain/eligibility";
import { effectiveStaffing, rotationById } from "@/domain/lookups";
import type { Assignment, Block, Project, Resident, Rotation, ValidationIssue } from "@/domain/types";
import { assignmentFingerprint } from "./metrics";
import { validateSchedule } from "./validate";

export interface Repair {
  id: string;
  summary: string;
  changes: number;
  assignments: Assignment[];
}

export interface RepairPlan {
  repairs: Repair[];
  note: string;
}

interface Draft {
  summary: string;
  changes: number;
  assignments: Assignment[];
}

const CHECKS = 80;

export function repairsForIssue(project: Project, issue: ValidationIssue, limit = 5): RepairPlan {
  const original = validateSchedule(project, project.assignments).issues;
  const one = choose(project, original, issue, oneChange(project, issue), limit);
  const repairs = one.length > 0 ? one : choose(project, original, issue, twoChanges(project, issue), limit);
  return {
    repairs,
    note: repairs.length ? "Other assignments stay as they are." : emptyNote(project, issue),
  };
}

function oneChange(project: Project, issue: ValidationIssue): Draft[] {
  if (issue.code === "duplicate") return duplicateDrafts(project, issue);
  if (issue.code === "lock" || issue.code === "protected-leave") return forcedDrafts(project, issue);
  if (issue.code === "ineligible" || issue.code === "missing") return cellDrafts(project, issue, 1);
  if (issue.code === "staffing-min" || issue.code === "staffing-max") return staffingDrafts(project, issue, 1);
  if (issue.code === "annual-cap") return capDrafts(project, issue, 1);
  if (issue.code === "consecutive" || issue.code === "duration") return runDrafts(project, issue, 1);
  if (issue.code === "category-adjacency") return adjacencyDrafts(project, issue);
  if (issue.code === "requirement") return requirementDrafts(project, issue, 1);
  if (issue.code === "prerequisite") return prerequisiteDrafts(project, issue, 1);
  return [];
}

function twoChanges(project: Project, issue: ValidationIssue): Draft[] {
  if (issue.code === "staffing-min" || issue.code === "staffing-max") return staffingDrafts(project, issue, 2);
  if (issue.code === "annual-cap") return capDrafts(project, issue, 2);
  if (issue.code === "consecutive" || issue.code === "duration") return runDrafts(project, issue, 2);
  if (issue.code === "requirement") return requirementDrafts(project, issue, 2);
  if (issue.code === "prerequisite") return prerequisiteDrafts(project, issue, 2);
  if (issue.code === "ineligible") return cellDrafts(project, issue, 2);
  return [];
}

function choose(project: Project, original: ValidationIssue[], target: ValidationIssue, drafts: Draft[], limit: number): Repair[] {
  const before = new Set(original.map(issueKey));
  const targetKey = issueKey(target);
  const seen = new Set<string>();
  const repairs: Repair[] = [];
  let checks = 0;
  for (const draft of drafts) {
    if (repairs.length >= limit || checks >= CHECKS) break;
    checks += 1;
    const keys = validateSchedule(project, draft.assignments).issues.map(issueKey);
    if (keys.includes(targetKey) || keys.some((key) => !before.has(key))) continue;
    const fingerprint = assignmentFingerprint(draft.assignments);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    repairs.push({ id: `repair-${repairs.length}-${targetKey}`, ...draft });
  }
  return repairs;
}

function cellDrafts(project: Project, issue: ValidationIssue, count: number): Draft[] {
  const resident = residentOf(project, issue.residentId);
  const block = blockOf(project, issue.blockId);
  if (!resident || !block || !movable(project, resident, block.id)) return [];
  if (count === 1) {
    return alternatives(project, resident, block, currentRotation(project, resident.id, block.id)).map((rotation) =>
      moved(project, resident, block, rotation, 1),
    );
  }
  const neighbor = project.blocks.find((item) => item.index === block.index + 1);
  if (!neighbor || !movable(project, resident, neighbor.id)) return [];
  const drafts: Draft[] = [];
  for (const rotation of alternatives(project, resident, block, currentRotation(project, resident.id, block.id)).slice(0, 8)) {
    for (const next of alternatives(project, resident, neighbor, currentRotation(project, resident.id, neighbor.id)).slice(0, 6)) {
      drafts.push({
        summary: `${resident.name} to ${rotation.name}, then ${next.name}`,
        changes: 2,
        assignments: withRotation(withRotation(project.assignments, resident.id, block.id, rotation.id), resident.id, neighbor.id, next.id),
      });
    }
  }
  return drafts;
}

function duplicateDrafts(project: Project, issue: ValidationIssue): Draft[] {
  const resident = residentOf(project, issue.residentId);
  const block = blockOf(project, issue.blockId);
  if (!resident || !block) return [];
  const present = project.assignments.filter((item) => item.residentId === resident.id && item.blockId === block.id);
  const drafts: Draft[] = [];
  for (const assignment of present) {
    const rotation = rotationById(project, assignment.rotationId);
    if (!rotation || !isEligible(project, resident, rotation, block)) continue;
    drafts.push({
      summary: `Keep ${rotation.name}`,
      changes: Math.max(1, present.length - 1),
      assignments: withRotation(project.assignments, resident.id, block.id, rotation.id),
    });
  }
  if (drafts.length) return drafts;
  return cellDrafts(project, issue, 1);
}

function forcedDrafts(project: Project, issue: ValidationIssue): Draft[] {
  const resident = residentOf(project, issue.residentId);
  const block = blockOf(project, issue.blockId);
  if (!resident || !block) return [];
  const forced = forcedChoice(project, resident, block.id);
  const rotation = forced.rotationId ? rotationById(project, forced.rotationId) : undefined;
  if (!rotation || !isEligible(project, resident, rotation, block)) return [];
  if (currentRotation(project, resident.id, block.id) === rotation.id) return [];
  return [moved(project, resident, block, rotation, 1)];
}

function staffingDrafts(project: Project, issue: ValidationIssue, count: number): Draft[] {
  const block = blockOf(project, issue.blockId);
  const rotation = issue.rotationId ? rotationById(project, issue.rotationId) : undefined;
  if (!block || !rotation) return [];
  const onIt = project.residents.filter((resident) => currentRotation(project, resident.id, block.id) === rotation.id);
  const offIt = project.residents.filter(
    (resident) => currentRotation(project, resident.id, block.id) !== rotation.id && movable(project, resident, block.id) && isEligible(project, resident, rotation, block),
  );
  if (issue.code === "staffing-min") {
    const need = Math.max(1, effectiveStaffing(project, rotation, block.id).min - onIt.length);
    if (count === need) {
      return groups(offIt, count).map((group) => ({
        summary: `${group.map((resident) => resident.name).join(", ")} to ${rotation.name}`,
        changes: group.length,
        assignments: group.reduce((assignments, resident) => withRotation(assignments, resident.id, block.id, rotation.id), project.assignments),
      }));
    }
    if (count === 2 && need === 1) {
      const drafts: Draft[] = [];
      for (const mover of offIt) {
        const left = rotationById(project, currentRotation(project, mover.id, block.id));
        if (!left) continue;
        const covers = project.residents.filter(
          (resident) => resident.id !== mover.id && currentRotation(project, resident.id, block.id) !== left.id && movable(project, resident, block.id) && isEligible(project, resident, left, block),
        );
        for (const cover of covers.slice(0, 8)) {
          drafts.push({
            summary: `${mover.name} to ${rotation.name}, ${cover.name} to ${left.name}`,
            changes: 2,
            assignments: withRotation(withRotation(project.assignments, mover.id, block.id, rotation.id), cover.id, block.id, left.id),
          });
        }
      }
      return drafts;
    }
    return [];
  }
  const leaving = onIt.filter((resident) => movable(project, resident, block.id));
  if (count === 1) {
    const drafts: Draft[] = [];
    for (const resident of leaving) {
      for (const next of alternatives(project, resident, block, rotation.id).slice(0, 6)) drafts.push(moved(project, resident, block, next, 1));
    }
    return drafts;
  }
  const drafts: Draft[] = [];
  for (const group of groups(leaving, 2)) {
    const first = alternatives(project, group[0], block, rotation.id).slice(0, 4);
    const second = alternatives(project, group[1], block, rotation.id).slice(0, 4);
    for (const left of first) {
      for (const right of second) {
        drafts.push({
          summary: `${group[0].name} to ${left.name}, ${group[1].name} to ${right.name}`,
          changes: 2,
          assignments: withRotation(withRotation(project.assignments, group[0].id, block.id, left.id), group[1].id, block.id, right.id),
        });
      }
    }
  }
  return drafts;
}

function capDrafts(project: Project, issue: ValidationIssue, count: number): Draft[] {
  const resident = residentOf(project, issue.residentId);
  const rotation = issue.rotationId ? rotationById(project, issue.rotationId) : undefined;
  if (!resident || !rotation || rotation.maxBlocksPerResident == null) return [];
  const held = project.blocks.filter((block) => currentRotation(project, resident.id, block.id) === rotation.id && movable(project, resident, block.id));
  const excess = held.length - rotation.maxBlocksPerResident;
  if (excess <= 0 || count < excess) return [];
  const drafts: Draft[] = [];
  for (const group of groups(held, count)) {
    const options = group.map((block) => alternatives(project, resident, block, rotation.id).slice(0, 4));
    if (options.some((list) => list.length === 0)) continue;
    for (const picked of product(options).slice(0, 24)) {
      let assignments = project.assignments;
      picked.forEach((next, index) => {
        assignments = withRotation(assignments, resident.id, group[index].id, next.id);
      });
      drafts.push({
        summary: picked.map((next, index) => `${group[index].label} to ${next.name}`).join(", "),
        changes: count,
        assignments,
      });
    }
  }
  return drafts;
}

function runDrafts(project: Project, issue: ValidationIssue, count: number): Draft[] {
  const resident = residentOf(project, issue.residentId);
  const start = blockOf(project, issue.blockId);
  const rotation = issue.rotationId ? rotationById(project, issue.rotationId) : undefined;
  if (!resident || !start || !rotation) return [];
  const run: Block[] = [];
  for (let index = start.index; index < project.blocks.length; index += 1) {
    const block = project.blocks[index];
    if (currentRotation(project, resident.id, block.id) !== rotation.id) break;
    run.push(block);
  }
  const editable = run.filter((block) => movable(project, resident, block.id));
  if (issue.code === "duration") {
    const extra = run.length % Math.max(1, rotation.durationBlocks);
    const shorten = extra === 0 ? editable : [editable[0], editable[editable.length - 1]].filter((block): block is Block => Boolean(block));
    if (count === 1) return swapBlocks(project, resident, shorten.slice(0, 2), rotation.id);
    return [];
  }
  if (count === 1) return swapBlocks(project, resident, editable, rotation.id);
  const drafts: Draft[] = [];
  for (const group of groups(editable, 2)) {
    const options = group.map((block) => alternatives(project, resident, block, rotation.id).slice(0, 4));
    for (const picked of product(options).slice(0, 16)) {
      let assignments = project.assignments;
      picked.forEach((next, index) => {
        assignments = withRotation(assignments, resident.id, group[index].id, next.id);
      });
      drafts.push({
        summary: `${resident.name}: ${picked.map((next) => next.name).join(" and ")}`,
        changes: 2,
        assignments,
      });
    }
  }
  return drafts;
}

function adjacencyDrafts(project: Project, issue: ValidationIssue): Draft[] {
  const resident = residentOf(project, issue.residentId);
  const left = blockOf(project, issue.blockId);
  if (!resident || !left) return [];
  const right = project.blocks.find((block) => block.index === left.index + 1);
  const slots = [left, right].filter((block): block is Block => block != null).filter((block) => movable(project, resident, block.id));
  const drafts: Draft[] = [];
  for (const block of slots) drafts.push(...swapBlocks(project, resident, [block], currentRotation(project, resident.id, block.id)));
  return drafts;
}

function requirementDrafts(project: Project, issue: ValidationIssue, count: number): Draft[] {
  const resident = residentOf(project, issue.residentId);
  const requirement = project.requirements.find((item) => item.id === issue.requirementId);
  if (!resident || !requirement) return [];
  const crediting = project.rotations.filter((rotation) => rotation.requirementCredits.some((credit) => credit.requirementId === requirement.id && credit.credits > 0) || requirement.rotationIds.includes(rotation.id));
  const slots = project.blocks.filter((block) => movable(project, resident, block.id) && !crediting.some((rotation) => rotation.id === currentRotation(project, resident.id, block.id)));
  if (count === 1) {
    const drafts: Draft[] = [];
    for (const block of slots) {
      for (const rotation of crediting) {
        if (!isEligible(project, resident, rotation, block) || rotation.durationBlocks > 1) continue;
        drafts.push(moved(project, resident, block, rotation, 1));
      }
    }
    return drafts;
  }
  const drafts: Draft[] = [];
  for (const group of groups(slots, 2).slice(0, 12)) {
    const options = group.map((block) => crediting.filter((rotation) => rotation.durationBlocks <= 1 && isEligible(project, resident, rotation, block)).slice(0, 3));
    for (const picked of product(options).slice(0, 9)) {
      let assignments = project.assignments;
      picked.forEach((rotation, index) => {
        assignments = withRotation(assignments, resident.id, group[index].id, rotation.id);
      });
      drafts.push({
        summary: `${resident.name}: ${picked.map((rotation) => rotation.name).join(" and ")}`,
        changes: 2,
        assignments,
      });
    }
  }
  return drafts;
}

function prerequisiteDrafts(project: Project, issue: ValidationIssue, count: number): Draft[] {
  const resident = residentOf(project, issue.residentId);
  const block = blockOf(project, issue.blockId);
  const rotation = issue.rotationId ? rotationById(project, issue.rotationId) : undefined;
  if (!resident || !block || !rotation) return [];
  const drafts: Draft[] = [];
  if (count === 1 && movable(project, resident, block.id)) drafts.push(...swapBlocks(project, resident, [block], rotation.id));
  const earlier = project.blocks.filter((item) => item.index < block.index && movable(project, resident, item.id));
  const needed = rotation.prerequisites;
  for (const prerequisite of needed) {
    const target = rotationById(project, prerequisite.rotationId);
    if (!target) continue;
    const open = earlier.filter((item) => currentRotation(project, resident.id, item.id) !== target.id && isEligible(project, resident, target, item));
    if (count === 1) {
      for (const item of open.slice(0, 8)) drafts.push(moved(project, resident, item, target, 1));
    } else {
      for (const group of groups(open, 2).slice(0, 10)) {
        drafts.push({
          summary: `${group.map((item) => item.label).join(" and ")} to ${target.name}`,
          changes: 2,
          assignments: group.reduce((assignments, item) => withRotation(assignments, resident.id, item.id, target.id), project.assignments),
        });
      }
    }
  }
  return drafts;
}

function swapBlocks(project: Project, resident: Resident, blocks: Block[], except: string): Draft[] {
  const drafts: Draft[] = [];
  for (const block of blocks) {
    for (const rotation of alternatives(project, resident, block, except).slice(0, 8)) drafts.push(moved(project, resident, block, rotation, 1));
  }
  return drafts;
}

function alternatives(project: Project, resident: Resident, block: Block, except: string): Rotation[] {
  return project.rotations
    .filter((rotation) => rotation.id !== except && rotation.durationBlocks <= 1 && isEligible(project, resident, rotation, block))
    .sort((left, right) => preference(right, except) - preference(left, except) || left.name.localeCompare(right.name));
}

function preference(rotation: Rotation, except: string): number {
  const tokens = except.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  const hay = `${rotation.id} ${rotation.name}`.toLowerCase();
  const overlap = tokens.reduce((sum, token) => sum + (hay.includes(token) ? 1 : 0), 0);
  return overlap * 10 - (rotation.category === "vacation" ? 1 : 0);
}

function moved(project: Project, resident: Resident, block: Block, rotation: Rotation, changes: number): Draft {
  return {
    summary: `${resident.name} · ${block.label} · ${rotation.name}`,
    changes,
    assignments: withRotation(project.assignments, resident.id, block.id, rotation.id),
  };
}

function withRotation(assignments: Assignment[], residentId: string, blockId: string, rotationId: string): Assignment[] {
  const current = assignments.find((item) => item.residentId === residentId && item.blockId === blockId);
  return [
    ...assignments.filter((item) => item.residentId !== residentId || item.blockId !== blockId),
    {
      residentId,
      blockId,
      rotationId,
      locked: false,
      source: "manual",
      ...(current?.duties?.length ? { duties: current.duties } : {}),
    },
  ];
}

function movable(project: Project, resident: Resident, blockId: string): boolean {
  const forced = forcedChoice(project, resident, blockId);
  return !forced.conflict && !forced.rotationId;
}

function currentRotation(project: Project, residentId: string, blockId: string): string {
  return project.assignments.find((item) => item.residentId === residentId && item.blockId === blockId)?.rotationId ?? "";
}

function residentOf(project: Project, id: string | undefined): Resident | undefined {
  return id ? project.residents.find((resident) => resident.id === id) : undefined;
}

function blockOf(project: Project, id: string | undefined): Block | undefined {
  return id ? project.blocks.find((block) => block.id === id) : undefined;
}

function emptyNote(project: Project, issue: ValidationIssue): string {
  const resident = residentOf(project, issue.residentId);
  const block = blockOf(project, issue.blockId);
  if (resident && block) {
    const forced = forcedChoice(project, resident, block.id);
    const rotation = forced.rotationId ? rotationById(project, forced.rotationId) : undefined;
    if (forced.rotationId && (!rotation || !isEligible(project, resident, rotation, block))) {
      return "The required rotation cannot be assigned. The lock or approved leave has to change before this conflict can be resolved.";
    }
  }
  if ((issue.code === "ineligible" || issue.code === "missing") && resident && block && alternatives(project, resident, block, "").length === 0) {
    return "No rotation is available for this resident in this block.";
  }
  return "Every small change that fixes this conflict creates another one.";
}

function issueKey(issue: ValidationIssue): string {
  return [issue.code, issue.residentId ?? "", issue.blockId ?? "", issue.rotationId ?? "", issue.requirementId ?? ""].join("|");
}

function groups<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [[]];
  const out: T[][] = [];
  const walk = (start: number, picked: T[]) => {
    if (out.length >= 30) return;
    if (picked.length === size) {
      out.push([...picked]);
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      picked.push(items[index]);
      walk(index + 1, picked);
      picked.pop();
      if (out.length >= 30) return;
    }
  };
  walk(0, []);
  return out;
}

function product<T>(lists: T[][]): T[][] {
  if (lists.length === 0) return [[]];
  const [first, ...rest] = lists;
  const tail = product(rest);
  const out: T[][] = [];
  for (const item of first) {
    for (const picked of tail) {
      out.push([item, ...picked]);
      if (out.length >= 40) return out;
    }
  }
  return out;
}
