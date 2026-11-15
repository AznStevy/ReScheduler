import { repairsForIssue } from "@/solver/repair";
import { topSolutions } from "@/solver/solutions";
import { validateSchedule } from "@/solver/validate";
import type { Proposal } from "@/domain/types";
import { useApp } from "@/state/store";
import { categoryBackground, rotationAbbrev } from "@/ui/abbrev";
import { Badge, Button, Field, Modal, NumberInput } from "@/ui/kit";
import { Fragment, useMemo, useState } from "react";

export function OptimizeSection() {
  const { snapshot, solver, solverDetail, optimizing, elapsed, result, generate, stop, updateSettings, applyProposal } = useApp();
  const solutions = result ? topSolutions(result.proposals) : [];
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = solutions.find((proposal) => proposal.id === previewId) ?? null;
  const status = !result
    ? (optimizing ? "Generating" : "No results available")
    : result.cancelled
      ? "Cancelled"
      : result.feasible && solutions.some((proposal) => proposal.provenOptimal)
        ? "Optimal"
        : result.feasible
          ? "Feasible"
          : result.provedInfeasible
            ? "Infeasible"
            : "No solution";
  const limit = snapshot.settings.timeLimitSeconds;
  const over = optimizing && elapsed > limit;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3 border border-line bg-card p-3">
        <Button onClick={generate} disabled={solver !== "ready" || optimizing}>Generate Schedule</Button>
        <Button variant="danger" onClick={stop} disabled={!optimizing}>Stop</Button>
        <Field label="Time Limit (sec)">
          <NumberInput className="w-24" min={1} max={120} value={limit} onChange={(event) => updateSettings({ ...snapshot.settings, timeLimitSeconds: Number(event.target.value) || 1 })} />
        </Field>
        <div className="ml-auto font-mono text-[13px] text-ink">
          <div>Status <span className="text-navy">{status}</span></div>
          <div>Elapsed {optimizing || result ? `${elapsed.toFixed(1)}s` : "—"}{(optimizing || result) ? ` / ${limit}s` : ""}</div>
        </div>
      </div>
      <p className="text-[14px] text-ink">
        {optimizing
          ? `Searching. The run stops at ${limit} seconds.`
          : solutions.length
            ? "Preview a solution before applying it. The current schedule stays until you apply one."
            : result
              ? result.message
              : "No results available."}
      </p>
      {over ? <p className="text-[13px] text-muted">Stopping at the time limit.</p> : null}
      {solutions.length ? (
        <div className="overflow-auto border border-line bg-card">
          <table className="data-table w-full min-w-[760px] text-left text-[14px]">
            <thead className="bg-head text-[12px]">
              <tr>
                <th className="px-2 py-1">Solution</th>
                <th>Coverage</th>
                <th>Requirements</th>
                <th>Vacation</th>
                <th>Career</th>
                <th>Changes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {solutions.map((proposal, index) => (
                <tr key={proposal.id} className="border-t border-line">
                  <td className="px-2 py-1">
                    <div className="font-semibold">{index + 1}. {proposal.title}</div>
                    <div className="text-[12px] text-muted">{proposal.provenOptimal ? "Proved optimal" : "Best found within the time limit"}{proposal.relaxations.length ? ` · ${proposal.relaxations.length} modification${proposal.relaxations.length === 1 ? "" : "s"}` : ""}</div>
                  </td>
                  <td className="font-mono">{proposal.metrics.staffingShortfalls.length}</td>
                  <td className="font-mono">{proposal.metrics.residentsBehind}</td>
                  <td className="font-mono">{Math.round(proposal.metrics.vacationScore * 100)}%</td>
                  <td className="font-mono">{Math.round(proposal.metrics.careerScore * 100)}%</td>
                  <td className="font-mono">{proposal.metrics.changedAssignments}</td>
                  <td className="px-2 py-1">
                    <div className="flex justify-end gap-2">
                      <Button variant="quiet" onClick={() => setPreviewId(proposal.id)}>Preview</Button>
                      <Button onClick={() => applyProposal(proposal)}>Apply</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Modal wide open={Boolean(preview)} title={preview?.title ?? "Solution"} onClose={() => setPreviewId(null)}>
        {preview ? <SolutionPreview proposal={preview} onApply={() => { applyProposal(preview); setPreviewId(null); }} /> : null}
      </Modal>
      <p data-testid="solver-status" className="sr-only">
        {solver === "ready" ? solverDetail : solver === "failed" ? `Unable to load scheduler. ${solverDetail}` : "Loading"}
      </p>
      {solver === "failed" ? <p className="text-[14px] text-bad">Unable to load the scheduler. {solverDetail}</p> : null}
    </div>
  );
}

function SolutionPreview({ proposal, onApply }: { proposal: Proposal; onApply: () => void }) {
  const { snapshot } = useApp();
  const project = snapshot.project;
  const byCell = new Map(proposal.assignments.map((assignment) => [`${assignment.residentId}:${assignment.blockId}`, assignment.rotationId]));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">{proposal.summary}</p>
        <Button onClick={onApply}>Apply</Button>
      </div>
      <div className="max-h-[60vh] min-h-[240px] overflow-auto border border-line">
        <table className="border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-head">
            <tr>
              <th className="sticky left-0 z-20 min-w-[180px] border-b border-r border-line bg-head px-2 py-1 text-[12px]">Resident</th>
              {project.blocks.map((block) => (
                <th key={block.id} className="min-w-[84px] border-b border-l border-line px-1 py-1 font-mono text-[11px] font-normal">
                  <div>{block.id.toUpperCase()}</div>
                  <div className="text-muted">{block.holiday ? "HOL" : block.startDate.slice(5)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {project.residents.map((person) => (
              <tr key={person.id} className="border-b border-line">
                <th className="sticky left-0 z-10 border-r border-line bg-card px-2 py-1 text-left text-[13px] font-semibold text-ink">{person.name}</th>
                {project.blocks.map((block) => {
                  const rotationId = byCell.get(`${person.id}:${block.id}`);
                  const rotation = project.rotations.find((item) => item.id === rotationId);
                  return (
                    <td
                      key={block.id}
                      title={rotation?.name ?? "Unassigned"}
                      className="on-tint border-l border-line px-1 py-1 font-mono text-[12px]"
                      style={{ background: rotation ? categoryBackground(rotation.category) : "var(--color-card)" }}
                    >
                      {rotation ? rotationAbbrev(rotation) : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ISSUE_LABEL: Record<string, string> = {
  duplicate: "Duplicate",
  missing: "Unassigned",
  "protected-leave": "Leave",
  lock: "Locked",
  ineligible: "Ineligible",
  "staffing-min": "Coverage",
  "staffing-max": "Coverage",
  "annual-cap": "Cap",
  consecutive: "Consecutive",
  "category-adjacency": "Adjacent",
  requirement: "Requirement",
  duration: "Duration",
  prerequisite: "Prerequisite",
};

export function ConflictsSection() {
  const { result, snapshot, setAssignments, setNotice } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const validation = useMemo(
    () => validateSchedule(snapshot.project, snapshot.project.assignments),
    [snapshot.project],
  );
  const count = validation.issues.length;
  return (
    <div className="grid gap-3">
      <section className="grid gap-2">
        <h2 className="text-[15px] font-semibold text-navy">Current schedule</h2>
        {snapshot.project.assignments.length === 0 ? (
          <p className="text-[14px]">No schedule to check.</p>
        ) : count === 0 ? (
          <p className="text-[14px]">No conflicts in the current schedule.</p>
        ) : (
          <>
            <p className="text-[14px]">Resolve fixes that conflict and leaves the other assignments in place. Up to 5 ways are listed, using as few changes as possible.</p>
            <p className="font-mono text-[13px]">{count === 1 ? "1 conflict" : `${count} conflicts`}</p>
            <div className="max-h-[70vh] overflow-auto border border-line bg-card">
              <table className="data-table w-full text-left text-[14px]">
                <thead className="sticky top-0 bg-head">
                  <tr><th className="px-2 py-1">Conflict</th><th>Detail</th><th></th></tr>
                </thead>
                <tbody>
                  {validation.issues.map((issue, index) => {
                    const key = `${issue.code}-${issue.residentId ?? ""}-${issue.blockId ?? ""}-${issue.rotationId ?? ""}-${issue.requirementId ?? ""}-${index}`;
                    const plan = open === key ? repairsForIssue(snapshot.project, issue) : null;
                    return (
                      <Fragment key={key}>
                        <tr className="border-t border-line align-top">
                          <td className="px-2 py-1"><Badge tone={issue.code === "staffing-min" || issue.code === "staffing-max" || issue.code === "requirement" ? "warn" : "bad"}>{ISSUE_LABEL[issue.code] ?? "Conflict"}</Badge></td>
                          <td className="py-1 pr-2">{issue.message}</td>
                          <td className="px-2 py-1"><Button variant="quiet" onClick={() => setOpen(open === key ? null : key)}>{open === key ? "Hide" : "Resolve"}</Button></td>
                        </tr>
                        {plan ? (
                          <tr className="border-t border-line bg-head/40">
                            <td colSpan={3} className="px-2 py-2">
                              {plan.repairs.length === 0 ? <p>{plan.note}</p> : (
                                <ul className="grid gap-1">
                                  {plan.repairs.map((repair, repairIndex) => (
                                    <li key={repair.id} className="flex flex-wrap items-center justify-between gap-2">
                                      <span><span className="font-mono text-[12px] text-muted">{repairIndex + 1}</span> {repair.summary}</span>
                                      <span className="flex items-center gap-2">
                                        <span className="font-mono text-[12px] text-muted">{repair.changes === 1 ? "1 change" : `${repair.changes} changes`}</span>
                                        <Button onClick={() => { setAssignments(repair.assignments); setNotice("That conflict was updated. The other assignments stay as they are."); setOpen(null); }}>Apply</Button>
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {plan.repairs.length ? <p className="mt-1 text-[13px] text-muted">{plan.note}</p> : null}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      {result ? (
      <>
      <details className="border border-line bg-card px-2 py-1 text-[12px]">
        <summary>Audit</summary>
        <ul className="mt-1 max-h-40 overflow-auto font-mono">
          {snapshot.audit.slice().reverse().map((entry) => <li key={entry.id}>{entry.at.slice(0, 16).replace("T", " ")} {entry.action} {entry.detail}</li>)}
        </ul>
      </details>
      </>
      ) : null}
    </div>
  );
}
