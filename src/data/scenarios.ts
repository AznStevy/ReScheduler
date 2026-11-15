import { makeBlocks } from "@/domain/calendar";
import type {
  Assignment,
  Block,
  CareerInterest,
  OptimizationSettings,
  PreviousRotation,
  Project,
  Requirement,
  Resident,
  Rotation,
  RotationCategory,
  Snapshot,
  VacationRequest,
} from "@/domain/types";

export const INTERESTS: CareerInterest[] = [
  { id: "cardiology", name: "Cardiology" },
  { id: "gastroenterology", name: "Gastroenterology" },
  { id: "pulmonary-critical-care", name: "Pulmonary/Critical Care" },
  { id: "hematology-oncology", name: "Hematology/Oncology" },
  { id: "nephrology", name: "Nephrology" },
  { id: "infectious-disease", name: "Infectious Disease" },
  { id: "rheumatology", name: "Rheumatology" },
  { id: "endocrinology", name: "Endocrinology" },
  { id: "primary-care", name: "Primary Care" },
  { id: "hospital-medicine", name: "Hospital Medicine" },
  { id: "research", name: "Research" },
];

const GIVEN = [
  "Avery",
  "Blake",
  "Casey",
  "Drew",
  "Ellis",
  "Finley",
  "Gray",
  "Harper",
  "Indigo",
  "Jules",
  "Kai",
  "Lane",
  "Marlow",
  "Noor",
  "Oakley",
  "Parker",
  "Quinn",
  "Reese",
  "Shiloh",
  "Tatum",
];

const FAMILY = [
  "Alden",
  "Brooks",
  "Cho",
  "Dalal",
  "Ellison",
  "Farooq",
  "Ibarra",
  "Johal",
  "Kline",
  "Moreau",
  "Nash",
  "Okoye",
  "Petrov",
  "Rahman",
  "Sato",
  "Voss",
];

export function defaultSettings(): OptimizationSettings {
  return { timeLimitSeconds: 20, randomSeed: 1, mipRelGap: 0, generateAlternatives: true };
}

export function snapshotOf(project: Project, settings = defaultSettings()): Snapshot {
  return { project, versions: [], audit: [], settings };
}

function baseProject(partial: Partial<Project> & Pick<Project, "id" | "name" | "blocks">): Project {
  return {
    formatVersion: 1,
    academicYear: "2026-2027",
    asOfDate: "2026-11-12",
    blockWeeks: 4,
    interests: INTERESTS,
    residents: [],
    rotations: [],
    requirements: [],
    vacations: [],
    vacationRules: { defaultCapacity: 8, capacityByBlock: [], blackoutBlockIds: [] },
    assignments: [],
    staffingWaivers: [],
    scenarioNote: "",
    syntheticDemo: true,
    ...partial,
  };
}

function yearBlocks(): Block[] {
  return makeBlocks(13).map((block) => ({
    ...block,
    holiday: block.id === "b06" || block.id === "b07",
    label:
      block.id === "b06" ? "Block 6 · Thanksgiving" : block.id === "b07" ? "Block 7 · Winter holidays" : block.label,
  }));
}

function cells(blocks: Block[], min: number, max: number, holidayMin = min) {
  return blocks.map((block) => ({ blockId: block.id, min: block.holiday ? holidayMin : min, max }));
}

function rotation(
  blocks: Block[],
  id: string,
  name: string,
  category: RotationCategory,
  min: number,
  max: number,
  color: string,
  extra: Partial<Rotation> = {},
): Rotation {
  return {
    id,
    name,
    category,
    durationBlocks: 1,
    eligiblePgy: [1, 2, 3],
    eligibleTracks: [],
    requirementCredits: [],
    careerRelevance: [],
    workloadIntensity: category === "icu" || category === "night" ? 5 : category === "ward" ? 4 : category === "emergency" ? 3 : 2,
    maxConsecutive: null,
    maxBlocksPerResident: null,
    noConsecutiveCategories: [],
    prerequisites: [],
    availableBlocks: [],
    relaxStaffingMin: 0,
    relaxStaffingMax: 0,
    staffingPriority: 0,
    color,
    ...extra,
    staffing: extra.staffing ?? cells(blocks, min, max),
  };
}

function demoRotations(blocks: Block[]): Rotation[] {
  return [
    rotation(blocks, "wards", "General Medicine Wards", "ward", 6, 16, "#8c4a32", {
      staffing: cells(blocks, 6, 16, 8),
      careerRelevance: [
        { interestId: "hospital-medicine", score: 50 },
        { interestId: "primary-care", score: 15 },
      ],
      maxConsecutive: 4,
    }),
    rotation(blocks, "micu", "Medical ICU", "icu", 4, 6, "#7a2e3b", {
      staffing: cells(blocks, 4, 6, 5),
      careerRelevance: [{ interestId: "pulmonary-critical-care", score: 45 }],
      maxConsecutive: 2,
    }),
    rotation(blocks, "cicu", "Cardiac ICU", "icu", 2, 3, "#5c3b66", {
      eligiblePgy: [2, 3],
      careerRelevance: [{ interestId: "cardiology", score: 70 }],
      prerequisites: [{ rotationId: "micu", blocks: 1 }],
      maxConsecutive: 2,
    }),
    rotation(blocks, "nf", "Night Float", "night", 3, 5, "#24324a", {
      careerRelevance: [{ interestId: "hospital-medicine", score: 20 }],
      maxConsecutive: 2,
    }),
    rotation(blocks, "em", "Emergency Medicine", "emergency", 1, 3, "#a15c2a", { eligiblePgy: [1, 2] }),
    rotation(blocks, "amb", "Ambulatory Medicine", "ambulatory", 4, 12, "#2f6f62", {
      careerRelevance: [
        { interestId: "primary-care", score: 80 },
        { interestId: "endocrinology", score: 25 },
      ],
    }),
    rotation(blocks, "cards", "Cardiology", "elective", 0, 2, "#355c8a", {
      eligiblePgy: [2, 3],
      careerRelevance: [{ interestId: "cardiology", score: 100 }],
    }),
    rotation(blocks, "gi", "Gastroenterology", "elective", 0, 2, "#3f6b3a", {
      eligiblePgy: [2, 3],
      careerRelevance: [{ interestId: "gastroenterology", score: 100 }],
    }),
    rotation(blocks, "pulm", "Pulmonology", "elective", 0, 2, "#4e6e8a", {
      eligiblePgy: [2, 3],
      careerRelevance: [{ interestId: "pulmonary-critical-care", score: 100 }],
    }),
    rotation(blocks, "neph", "Nephrology", "elective", 0, 2, "#6a5a3a", {
      eligiblePgy: [2, 3],
      careerRelevance: [{ interestId: "nephrology", score: 100 }],
    }),
    rotation(blocks, "id", "Infectious Disease", "elective", 0, 2, "#6e4a3c", {
      eligiblePgy: [2, 3],
      careerRelevance: [{ interestId: "infectious-disease", score: 100 }],
    }),
    rotation(blocks, "research", "Research", "research", 0, 4, "#5a6670", {
      eligiblePgy: [2, 3],
      careerRelevance: [{ interestId: "research", score: 100 }],
      workloadIntensity: 1,
    }),
    rotation(blocks, "elective", "Elective", "elective", 0, 8, "#7d6a58", {
      eligiblePgy: [2, 3],
      careerRelevance: [
        { interestId: "hematology-oncology", score: 60 },
        { interestId: "rheumatology", score: 60 },
        { interestId: "endocrinology", score: 60 },
      ],
    }),
    rotation(blocks, "vacation", "Vacation", "vacation", 0, 8, "#d7c4a3", { workloadIntensity: 1 }),
  ];
}

function demoRequirements(blocks: Block[]): Requirement[] {
  const last = blocks[blocks.length - 1]?.id ?? null;
  return [
    requirement("wards-experience", "Inpatient ward experience", "Program-defined cumulative ward blocks across residency.", "program", 8, ["wards"], 0, false, 0, 4, { all: true }),
    requirement("critical-care", "Critical care experience", "Program-defined cumulative ICU blocks. Cardiac ICU requires prior medical ICU.", "program", 6, ["micu", "cicu"], 0, false, 0, 3, { all: true }),
    requirement("night-coverage", "Night-float experience", "Program-defined cumulative night-float blocks.", "program", 3, ["nf"], 0, false, 0, 2, { all: true }),
    requirement("ambulatory", "Ambulatory continuity", "Program-defined ambulatory blocks. One block of relaxation is authorized.", "program", 4, ["amb"], 1, true, 1, 3, { all: true }),
    requirement("em-intern", "Emergency medicine this year", "Applies to PGY-1 residents and is due by the last block of this academic year.", "pgy", 1, ["em"], 0, false, 0, null, { pgy: [1] }, last),
    requirement(
      "subspecialty",
      "Subspecialty and elective time",
      "Program-defined cumulative elective, consult, and research blocks. One block of relaxation is authorized.",
      "program",
      5,
      ["cards", "gi", "pulm", "neph", "id", "research", "elective"],
      1,
      true,
      1,
      4,
      { all: true },
    ),
  ];
}

function requirement(
  id: string,
  name: string,
  description: string,
  scope: Requirement["scope"],
  amount: number,
  rotationIds: string[],
  priority: number,
  relaxable: boolean,
  maxRelaxation: number,
  maxPerYear: number | null,
  appliesTo: Requirement["appliesTo"],
  deadlineBlockId: string | null = null,
): Requirement {
  return {
    id,
    name,
    description,
    scope,
    unit: "blocks",
    amount,
    appliesTo,
    rotationIds,
    deadlineBlockId,
    priority,
    relaxable,
    maxRelaxation,
    maxPerYear,
  };
}

function history(pgy: number, scarceMicu: boolean): PreviousRotation[] {
  if (pgy === 1) return [];
  if (pgy === 2) {
    return [
      { rotationId: "wards", blocks: scarceMicu ? 5 : 4 },
      { rotationId: "micu", blocks: scarceMicu ? 0 : 1 },
      { rotationId: "nf", blocks: 1 },
      { rotationId: "amb", blocks: 2 },
      { rotationId: "em", blocks: 1 },
      { rotationId: "vacation", blocks: 3 },
      { rotationId: "elective", blocks: 1 },
    ].filter((item) => item.blocks > 0);
  }
  return [
    { rotationId: "wards", blocks: 6 },
    { rotationId: "micu", blocks: 3 },
    { rotationId: "cicu", blocks: 1 },
    { rotationId: "nf", blocks: 2 },
    { rotationId: "amb", blocks: 3 },
    { rotationId: "em", blocks: 1 },
    { rotationId: "vacation", blocks: 6 },
    { rotationId: "cards", blocks: 1 },
    { rotationId: "gi", blocks: 1 },
    { rotationId: "research", blocks: 1 },
    { rotationId: "elective", blocks: 1 },
  ];
}

const INTEREST_ROTATION: Record<string, string> = {
  cardiology: "cards",
  gastroenterology: "gi",
  "pulmonary-critical-care": "pulm",
  nephrology: "neph",
  "infectious-disease": "id",
  research: "research",
  "primary-care": "amb",
  "hospital-medicine": "wards",
  "hematology-oncology": "elective",
  rheumatology: "elective",
  endocrinology: "elective",
};

export function buildInternalMedicineDemo(): Project {
  const blocks = yearBlocks();
  const residents: Resident[] = [];
  for (let index = 0; index < 60; index += 1) {
    const pgy = index < 24 ? 1 : index < 44 ? 2 : 3;
    const track = index % 15 === 0 ? "Physician-Scientist" : index % 7 === 0 ? "Primary Care" : "Categorical";
    const gradYear = 2026 + (4 - pgy);
    const scarceMicu = index === 24;
    const previous = history(pgy, scarceMicu);
    const primary = track === "Physician-Scientist" ? "research" : INTERESTS[index % INTERESTS.length].id;
    const secondary = INTERESTS[(index * 3 + 4) % INTERESTS.length].id;
    const firstElective = INTEREST_ROTATION[primary] ?? "elective";
    const secondElective = firstElective === "cards" ? "gi" : "cards";
    residents.push({
      id: `r${String(index + 1).padStart(2, "0")}`,
      name: `${GIVEN[index % GIVEN.length]} ${FAMILY[Math.floor(index / GIVEN.length) % FAMILY.length]}`,
      pgy,
      track,
      startDate: `${gradYear - 3}-07-01`,
      graduationDate: `${gradYear}-06-30`,
      previousRotations: previous,
      careerInterests: [
        { interestId: primary, rank: 1 },
        { interestId: secondary === primary ? INTERESTS[(index + 1) % INTERESTS.length].id : secondary, rank: 2 },
      ],
      electivePreferences:
        pgy === 1
          ? []
          : [
              { rotationId: firstElective, rank: 1 },
              { rotationId: secondElective, rank: 2 },
            ],
      restrictions: [],
      historicalBurden: {
        icu: previous.filter((item) => item.rotationId === "micu" || item.rotationId === "cicu").reduce((sum, item) => sum + item.blocks, 0),
        nights: previous.find((item) => item.rotationId === "nf")?.blocks ?? 0,
        wards: previous.find((item) => item.rotationId === "wards")?.blocks ?? 0,
        holiday: pgy > 1 && index % 2 === 0 ? 1 : 0,
      },
      lockedAssignments: [],
      waivers: [],
      notes: scarceMicu ? "No prior medical ICU. Cardiac ICU is not yet eligible." : "",
    });
  }

  const approvedOn = new Map<string, number>();
  const vacations: VacationRequest[] = [];
  residents.forEach((resident, index) => {
    const first = (index * 3) % 12;
    let second = (index * 3 + 5) % 12;
    if (second === first) second = (second + 1) % 12;
    const primary = blocks[first];
    const alternate = blocks[second];
    const used = approvedOn.get(primary.id) ?? 0;
    const approve = !primary.holiday && used < 2 && index % 5 === 0;
    if (approve) approvedOn.set(primary.id, used + 1);
    vacations.push({
      id: `vac-${resident.id}-1`,
      residentId: resident.id,
      blockId: primary.id,
      rank: 1,
      status: approve ? "approved" : "pending",
      alternatives: [alternate.id],
    });
    vacations.push({
      id: `vac-${resident.id}-2`,
      residentId: resident.id,
      blockId: alternate.id,
      rank: 2,
      status: "pending",
      alternatives: [],
    });
  });

  const locked = residents.filter((resident) => resident.pgy === 3).slice(0, 2);
  for (const resident of locked) {
    resident.lockedAssignments.push({ blockId: "b01", rotationId: "wards" });
  }

  return baseProject({
    id: "im-demo",
    name: "Sample program",
    blocks,
    residents,
    rotations: demoRotations(blocks),
    requirements: demoRequirements(blocks),
    vacations,
    vacationRules: {
      defaultCapacity: 8,
      capacityByBlock: [
        { blockId: "b06", capacity: 4 },
        { blockId: "b07", capacity: 4 },
      ],
      blackoutBlockIds: ["b13"],
    },
    scenarioNote:
      "Fictional sample program, included so the calendar and schedule are visible before a file is imported. Rotations and requirements are data, so any residency can replace them. Nothing in this dataset is a real person. Blocks 1–4 end before the sample date of 12 Nov 2026. Block 13 is a vacation blackout. Two PGY-3 ward assignments in Block 1 are locked, and a handful of vacation requests are already approved.",
  });
}

export function buildResolvableConflict(): Project {
  const blocks = makeBlocks(4);
  const people: Resident[] = [
    person("p3a", "Avery Quinn", 3),
    person("p3b", "Blake Santos", 3),
    { ...person("p2a", "Casey Okonkwo", 2), careerInterests: [{ interestId: "cardiology", rank: 1 }] },
    person("p2b", "Drew Patel", 2),
    person("p1a", "Ellis Nguyen", 1),
    person("p1b", "Finley Brooks", 1),
  ];
  const assignments: Assignment[] = blocks.flatMap((block, index) => [
    { residentId: "p3a", blockId: block.id, rotationId: index === 0 ? "icu" : "wards", locked: false, source: "manual" },
    { residentId: "p3b", blockId: block.id, rotationId: index === 1 ? "icu" : "wards", locked: false, source: "manual" },
    { residentId: "p2a", blockId: block.id, rotationId: index === 3 ? "cards" : "wards", locked: false, source: "manual" },
    { residentId: "p2b", blockId: block.id, rotationId: "wards", locked: false, source: "manual" },
    { residentId: "p1a", blockId: block.id, rotationId: index === 0 ? "vacation" : "wards", locked: false, source: "manual" },
    { residentId: "p1b", blockId: block.id, rotationId: "wards", locked: false, source: "manual" },
  ]);
  return baseProject({
    id: "resolvable-conflict",
    name: "Resolvable ICU conflict",
    asOfDate: "2026-07-01",
    blocks,
    residents: people,
    rotations: [
      rotation(blocks, "icu", "ICU", "icu", 0, 2, "#7a2e3b", { maxBlocksPerResident: 1 }),
      rotation(blocks, "wards", "Wards", "ward", 1, 6, "#8c4a32"),
      rotation(blocks, "cards", "Cardiology", "elective", 0, 1, "#355c8a", {
        careerRelevance: [{ interestId: "cardiology", score: 100 }],
      }),
      rotation(blocks, "vacation", "Vacation", "vacation", 0, 1, "#d7c4a3", { workloadIntensity: 1 }),
    ],
    requirements: [
      requirement(
        "icu-grad",
        "ICU before graduation",
        "Two ICU blocks are requested, but each resident may take ICU only once. A one-block waiver is explicitly authorized.",
        "individual",
        2,
        ["icu"],
        1,
        true,
        1,
        null,
        { residentIds: ["p3a", "p3b"] },
        blocks[3].id,
      ),
    ],
    vacations: [{ id: "vac", residentId: "p1a", blockId: blocks[3].id, rank: 1, status: "pending", alternatives: [blocks[0].id] }],
    vacationRules: { defaultCapacity: 1, capacityByBlock: [], blackoutBlockIds: [] },
    assignments,
    scenarioNote:
      "The strict model is infeasible: two graduating residents each need two ICU blocks, and ICU is capped at one block per resident. A one-block waiver is authorized. Pending vacation and a cardiology preference then pull the alternative proposals apart. Approved leave is not used here, so nothing immutable has to move.",
  });
}

export function buildImmutableConflict(): Project {
  const blocks = makeBlocks(2);
  return baseProject({
    id: "immutable-conflict",
    name: "Immutable staffing conflict",
    asOfDate: "2026-07-01",
    blocks,
    residents: [person("a", "Avery Quinn", 2), person("b", "Blake Santos", 2)],
    rotations: [
      rotation(blocks, "wards", "Wards", "ward", 3, 3, "#8c4a32"),
      rotation(blocks, "elective", "Elective", "elective", 0, 2, "#7d6a58"),
    ],
    scenarioNote:
      "Each block requires three ward residents, and the program only has two. That minimum is not authorized for relaxation, so ReScheduler should report that no valid schedule exists.",
  });
}

export function buildEmptyProject(): Project {
  const blocks = yearBlocks();
  return baseProject({
    id: "empty",
    name: "Empty program",
    blocks,
    rotations: demoRotations(blocks).map((item) => ({
      ...item,
      staffing: item.staffing.map((cell) => ({ ...cell, min: 0 })),
      relaxStaffingMin: 0,
    })),
    requirements: [],
    vacationRules: { defaultCapacity: 8, capacityByBlock: [], blackoutBlockIds: [] },
    syntheticDemo: false,
    scenarioNote: "No residents yet. Add people here or import a spreadsheet. Requirements start empty so you can define your own.",
  });
}

function person(id: string, name: string, pgy: number): Resident {
  const gradYear = 2030 - pgy;
  return {
    id,
    name,
    pgy,
    track: "Categorical",
    startDate: `${gradYear - 3}-07-01`,
    graduationDate: `${gradYear}-06-30`,
    previousRotations: [],
    careerInterests: [],
    electivePreferences: [],
    restrictions: [],
    historicalBurden: { icu: 0, nights: 0, wards: 0, holiday: 0 },
    lockedAssignments: [],
    waivers: [],
    notes: "",
  };
}
