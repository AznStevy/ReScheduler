export type RotationCategory =
  | "ward"
  | "icu"
  | "night"
  | "ambulatory"
  | "emergency"
  | "elective"
  | "research"
  | "vacation"
  | "other";

export type RequirementScope =
  | "accreditation"
  | "institutional"
  | "program"
  | "pgy"
  | "track"
  | "individual";

export type BurdenCategory = "icu" | "nights" | "wards" | "holiday";

export interface Block {
  id: string;
  index: number;
  label: string;
  startDate: string;
  endDate: string;
  holiday: boolean;
  /** When set, every assigned resident stays on the current rotation for this block. */
  locked?: boolean;
}

export interface CareerInterest {
  id: string;
  name: string;
}

export interface PreviousRotation {
  rotationId: string;
  blocks: number;
}

export interface RankedInterest {
  interestId: string;
  rank: number;
}

export interface RankedRotation {
  rotationId: string;
  rank: number;
}

export interface LockedAssignment {
  blockId: string;
  rotationId: string;
}

export interface Waiver {
  id: string;
  requirementId: string;
  amount: number;
  reason: string;
  grantedAt: string;
}

export interface HistoricalBurden {
  icu: number;
  nights: number;
  wards: number;
  holiday: number;
}

export interface Resident {
  id: string;
  name: string;
  pgy: number;
  track: string;
  startDate: string;
  graduationDate: string;
  previousRotations: PreviousRotation[];
  careerInterests: RankedInterest[];
  electivePreferences: RankedRotation[];
  restrictions: string[];
  historicalBurden: HistoricalBurden;
  lockedAssignments: LockedAssignment[];
  waivers: Waiver[];
  notes: string;
  /** When set, every assigned block for this resident stays on the current rotation. */
  locked?: boolean;
}

export interface StaffingCell {
  blockId: string;
  min: number;
  max: number;
}

export interface RequirementCredit {
  requirementId: string;
  credits: number;
}

export interface CareerScore {
  interestId: string;
  score: number;
}

export interface Prerequisite {
  rotationId: string;
  blocks: number;
}

export interface Rotation {
  id: string;
  name: string;
  category: RotationCategory;
  durationBlocks: number;
  eligiblePgy: number[];
  eligibleTracks: string[];
  staffing: StaffingCell[];
  requirementCredits: RequirementCredit[];
  careerRelevance: CareerScore[];
  workloadIntensity: number;
  maxConsecutive: number | null;
  maxBlocksPerResident: number | null;
  noConsecutiveCategories: RotationCategory[];
  prerequisites: Prerequisite[];
  availableBlocks: string[];
  relaxStaffingMin: number;
  relaxStaffingMax: number;
  staffingPriority: number;
  color: string;
}

export interface RequirementApplicability {
  all?: boolean;
  pgy?: number[];
  tracks?: string[];
  residentIds?: string[];
}

export interface Requirement {
  id: string;
  name: string;
  description: string;
  scope: RequirementScope;
  unit: "blocks" | "weeks";
  amount: number;
  appliesTo: RequirementApplicability;
  rotationIds: string[];
  deadlineBlockId: string | null;
  priority: number;
  relaxable: boolean;
  maxRelaxation: number;
  maxPerYear: number | null;
}

export interface VacationRequest {
  id: string;
  residentId: string;
  blockId: string;
  rank: number;
  status: "approved" | "pending";
  alternatives: string[];
}

export interface VacationRules {
  defaultCapacity: number;
  capacityByBlock: { blockId: string; capacity: number }[];
  blackoutBlockIds: string[];
}

/** A shift on one day of a block, kept from an import. The scheduler uses the block rotation only. */
export interface DayDuty {
  date: string;
  name: string;
}

export interface Assignment {
  residentId: string;
  blockId: string;
  rotationId: string;
  locked: boolean;
  source: "optimizer" | "manual" | "import" | "locked";
  duties?: DayDuty[];
}

export interface StaffingWaiver {
  id: string;
  blockId: string;
  rotationId: string;
  minReduction: number;
  maxIncrease: number;
  reason: string;
  grantedAt: string;
}

export interface Project {
  formatVersion: 1;
  id: string;
  name: string;
  academicYear: string;
  asOfDate: string;
  blockWeeks: number;
  blocks: Block[];
  interests: CareerInterest[];
  residents: Resident[];
  rotations: Rotation[];
  requirements: Requirement[];
  vacations: VacationRequest[];
  vacationRules: VacationRules;
  assignments: Assignment[];
  staffingWaivers: StaffingWaiver[];
  scenarioNote: string;
  syntheticDemo: boolean;
}

export interface OptimizationSettings {
  timeLimitSeconds: number;
  randomSeed: number | null;
  mipRelGap: number;
  generateAlternatives: boolean;
}

export interface ScheduleVersion {
  id: string;
  name: string;
  createdAt: string;
  assignments: Assignment[];
  note: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  detail: string;
}

export interface Snapshot {
  project: Project;
  versions: ScheduleVersion[];
  audit: AuditEntry[];
  settings: OptimizationSettings;
}

export interface ConflictFinding {
  id: string;
  severity: "immutable" | "relaxable" | "info";
  title: string;
  detail: string;
  verified: "structural" | "solver-tested";
  minimal: false;
  residentIds: string[];
  blockIds: string[];
  rotationIds: string[];
  requirementIds: string[];
}

export interface AppliedRelaxation {
  id: string;
  kind: "requirement" | "staffing-min" | "staffing-max";
  amount: number;
  residentId?: string;
  requirementId?: string;
  blockId?: string;
  rotationId?: string;
  priority: number;
  description: string;
}

export interface ValidationIssue {
  code: string;
  message: string;
  residentId?: string;
  blockId?: string;
  rotationId?: string;
  requirementId?: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface StaffingGap {
  blockId: string;
  rotationId: string;
  have: number;
  min: number;
  max: number;
}

export interface FairnessSpread {
  pgy: number;
  track: string;
  category: BurdenCategory;
  min: number;
  max: number;
}

export interface ScheduleMetrics {
  assignedCells: number;
  openCells: number;
  staffingShortfalls: StaffingGap[];
  staffingExcesses: StaffingGap[];
  vacationScore: number;
  vacationRank1Rate: number;
  fairnessSpread: FairnessSpread[];
  careerScore: number;
  residentsBehind: number;
  changedAssignments: number;
  consecutiveIntensive: number;
  relaxationCount: number;
}

export interface StageResult {
  id: string;
  label: string;
  status: string;
  displayObjective: number | null;
  runtimeSeconds: number;
  gap: number | null;
  provenOptimal: boolean;
}

export type ProposalKind = "balanced" | "vacation" | "fairness" | "career" | "stability";

export interface Proposal {
  id: string;
  kind: ProposalKind;
  title: string;
  summary: string;
  assignments: Assignment[];
  relaxations: AppliedRelaxation[];
  metrics: ScheduleMetrics;
  validation: ValidationReport;
  provenOptimal: boolean;
  stages: StageResult[];
  impacts: string[];
  duplicateOf: string | null;
}

export interface ModelStats {
  binaries: number;
  integers: number;
  continuous: number;
  constraints: number;
  eliminatedAssignments: number;
  possibleAssignments: number;
  warning: string | null;
}

export interface OptimizeResult {
  solver: "highs";
  cancelled: boolean;
  provedInfeasible: boolean;
  feasible: boolean;
  message: string;
  findings: ConflictFinding[];
  proposals: Proposal[];
  stats: ModelStats;
  stages: StageResult[];
}

export const SOLVER_LABEL = "HiGHS 1.15 (WebAssembly)";

export const STORAGE_WARNING =
  "Schedules are stored in this browser only. Clearing site data, using a private window, or switching computers removes them. This is not an enterprise-grade secure record system. Exported files contain the full schedule, so treat them like any other local document, especially on a shared computer.";
