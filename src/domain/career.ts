import type { Rotation } from "./types";

/**
 * A broad specialty matches a narrower rotation in that field.
 * A narrower interest does not match the broad rotation.
 */
const BROAD = new Set(["surgery", "pediatrics", "radiology", "pathology", "anesthesiology"]);

const STOP = new Set([
  "a", "am", "and", "back", "backup", "block", "call", "care", "center", "chief",
  "clinic", "community", "consult", "day", "do", "dr", "east", "elective", "float",
  "for", "from", "general", "hospital", "house", "inpatient", "inpt", "intern",
  "interns", "junior", "md", "medical", "medicine", "night", "north", "of", "on",
  "outpatient", "outpt", "pm", "program", "rapid", "resident", "residents", "response",
  "rotation", "senior", "service", "south", "team", "the", "to", "up", "west", "with",
]);

/** Longer phrases are applied first. A phrase can stand for more than one concept. */
const ALIASES: Array<[string, string[]]> = [
  ["maternal fetal medicine", ["obstetrics"]],
  ["physical medicine", ["pmr"]],
  ["interventional radiology", ["interventional", "radiology"]],
  ["radiation oncology", ["radiation-oncology"]],
  ["emergency medicine", ["emergency"]],
  ["internal medicine", ["hospital-medicine"]],
  ["general medicine", ["hospital-medicine"]],
  ["hospital medicine", ["hospital-medicine"]],
  ["family medicine", ["family"]],
  ["nuclear medicine", ["nuclear", "radiology"]],
  ["sleep medicine", ["sleep"]],
  ["pain medicine", ["pain"]],
  ["sports medicine", ["sports"]],
  ["addiction medicine", ["addiction"]],
  ["infectious disease", ["infectious-disease"]],
  ["primary care", ["primary-care"]],
  ["critical care", ["critical-care"]],
  ["heart failure", ["cardiology"]],
  ["substance abuse", ["addiction"]],
  ["substance use", ["addiction"]],
  ["heme onc", ["hematology", "oncology"]],
  ["rad onc", ["radiation-oncology"]],
  ["ob gyn", ["obstetrics"]],
  ["pulmonary critical care", ["pulmonary", "critical-care"]],
  ["cardiology", ["cardiology"]],
  ["cardiac", ["cardiology"]],
  ["cards", ["cardiology"]],
  ["cardio", ["cardiology"]],
  ["electrophysiology", ["cardiology"]],
  ["echocardiography", ["cardiology"]],
  ["echo", ["cardiology"]],
  ["ep", ["cardiology"]],
  ["cicu", ["cardiology", "critical-care"]],
  ["ccu", ["cardiology", "critical-care"]],
  ["gastroenterology", ["gastroenterology"]],
  ["hepatology", ["gastroenterology"]],
  ["gastro", ["gastroenterology"]],
  ["gi", ["gastroenterology"]],
  ["pulmonology", ["pulmonary"]],
  ["pulmonary", ["pulmonary"]],
  ["pulm", ["pulmonary"]],
  ["pccm", ["pulmonary", "critical-care"]],
  ["intensivist", ["critical-care"]],
  ["critical", ["critical-care"]],
  ["micu", ["pulmonary", "critical-care"]],
  ["msicu", ["pulmonary", "critical-care"]],
  ["sicu", ["surgery", "critical-care"]],
  ["picu", ["pediatrics", "critical-care"]],
  ["icu", ["critical-care"]],
  ["hematology", ["hematology"]],
  ["oncology", ["oncology"]],
  ["heme", ["hematology"]],
  ["onc", ["oncology"]],
  ["nephrology", ["nephrology"]],
  ["dialysis", ["nephrology"]],
  ["renal", ["nephrology"]],
  ["neph", ["nephrology"]],
  ["infectious", ["infectious-disease"]],
  ["id", ["infectious-disease"]],
  ["rheumatology", ["rheumatology"]],
  ["rheum", ["rheumatology"]],
  ["endocrinology", ["endocrinology"]],
  ["diabetes", ["endocrinology"]],
  ["thyroid", ["endocrinology"]],
  ["endo", ["endocrinology"]],
  ["neurology", ["neurology"]],
  ["stroke", ["neurology"]],
  ["neuro", ["neurology"]],
  ["neurosurgery", ["neurosurgery", "surgery"]],
  ["neurosurg", ["neurosurgery", "surgery"]],
  ["psychiatry", ["psychiatry"]],
  ["psych", ["psychiatry"]],
  ["dermatology", ["dermatology"]],
  ["derm", ["dermatology"]],
  ["emergency", ["emergency"]],
  ["em", ["emergency"]],
  ["ed", ["emergency"]],
  ["er", ["emergency"]],
  ["palliative", ["palliative"]],
  ["hospice", ["palliative"]],
  ["addiction", ["addiction"]],
  ["substance", ["addiction"]],
  ["geriatrics", ["geriatrics"]],
  ["geriatric", ["geriatrics"]],
  ["geri", ["geriatrics"]],
  ["research", ["research"]],
  ["scholarly", ["research"]],
  ["pediatrics", ["pediatrics"]],
  ["paediatrics", ["pediatrics"]],
  ["pediatric", ["pediatrics"]],
  ["paediatric", ["pediatrics"]],
  ["neonatology", ["neonatology", "pediatrics"]],
  ["neonatal", ["neonatology", "pediatrics"]],
  ["nicu", ["neonatology", "pediatrics"]],
  ["peds", ["pediatrics"]],
  ["anesthesiology", ["anesthesiology"]],
  ["anaesthesiology", ["anesthesiology"]],
  ["anesthesia", ["anesthesiology"]],
  ["anaesthesia", ["anesthesiology"]],
  ["pathology", ["pathology"]],
  ["path", ["pathology"]],
  ["radiology", ["radiology"]],
  ["imaging", ["radiology"]],
  ["rads", ["radiology"]],
  ["ir", ["interventional", "radiology"]],
  ["nuclear", ["nuclear"]],
  ["ophthalmology", ["ophthalmology"]],
  ["ophtho", ["ophthalmology"]],
  ["otolaryngology", ["otolaryngology"]],
  ["ent", ["otolaryngology"]],
  ["obstetrics", ["obstetrics"]],
  ["gynecology", ["obstetrics"]],
  ["gynaecology", ["obstetrics"]],
  ["obgyn", ["obstetrics"]],
  ["mfm", ["obstetrics"]],
  ["gyn", ["obstetrics"]],
  ["ob", ["obstetrics"]],
  ["orthopaedics", ["orthopedic", "surgery"]],
  ["orthopedics", ["orthopedic", "surgery"]],
  ["orthopaedic", ["orthopedic", "surgery"]],
  ["orthopedic", ["orthopedic", "surgery"]],
  ["ortho", ["orthopedic", "surgery"]],
  ["urology", ["urology"]],
  ["uro", ["urology"]],
  ["cardiothoracic", ["thoracic", "surgery"]],
  ["thoracic", ["thoracic", "surgery"]],
  ["cts", ["thoracic", "surgery"]],
  ["colorectal", ["colorectal", "surgery"]],
  ["transplant", ["transplant", "surgery"]],
  ["neurosurgical", ["neurosurgery", "surgery"]],
  ["vascular", ["vascular", "surgery"]],
  ["plastics", ["plastic", "surgery"]],
  ["plastic", ["plastic", "surgery"]],
  ["trauma", ["trauma", "surgery"]],
  ["surgical", ["surgery"]],
  ["surgery", ["surgery"]],
  ["surg", ["surgery"]],
  ["physiatry", ["pmr"]],
  ["rehabilitation", ["pmr"]],
  ["rehab", ["pmr"]],
  ["pmr", ["pmr"]],
  ["family", ["family"]],
  ["fm", ["family"]],
  ["ambulatory", ["primary-care"]],
  ["continuity", ["primary-care"]],
  ["primary", ["primary-care"]],
  ["pcp", ["primary-care"]],
  ["hospitalist", ["hospital-medicine"]],
  ["nocturnist", ["hospital-medicine"]],
  ["wards", ["hospital-medicine"]],
  ["ward", ["hospital-medicine"]],
  ["allergy", ["allergy"]],
  ["immunology", ["allergy"]],
  ["genetics", ["genetics"]],
  ["preventive", ["preventive"]],
  ["preventative", ["preventive"]],
  ["occupational", ["occupational"]],
  ["sleep", ["sleep"]],
  ["pain", ["pain"]],
  ["sports", ["sports"]],
];

const PHRASES = ALIASES.map(([phrase, concepts]) => ({
  tokens: phrase.split(" "),
  concepts,
})).sort((a, b) => b.tokens.length - a.tokens.length || b.tokens.join(" ").length - a.tokens.join(" ").length);

export function careerConcepts(value: string): Set<string> {
  const tokens = normalize(value).split(" ").filter(Boolean);
  const used = new Array<boolean>(tokens.length).fill(false);
  const found = new Set<string>();
  for (const phrase of PHRASES) {
    for (let start = 0; start <= tokens.length - phrase.tokens.length; start += 1) {
      const matches = phrase.tokens.every((token, offset) => !used[start + offset] && tokens[start + offset] === token);
      if (!matches) continue;
      phrase.concepts.forEach((concept) => found.add(concept));
      phrase.tokens.forEach((_, offset) => {
        used[start + offset] = true;
      });
    }
  }
  tokens.forEach((token, index) => {
    if (used[index] || STOP.has(token) || token.length < 4) return;
    found.add(token);
  });
  return found;
}

/** 100 when the names share a specialty, otherwise 0. */
export function inferredCareerScore(interestName: string, rotationName: string): number {
  const interest = careerConcepts(interestName);
  const rotation = careerConcepts(rotationName);
  const overlap = [...interest].filter((concept) => rotation.has(concept));
  if (!overlap.length) return 0;
  if (overlap.some((concept) => !BROAD.has(concept))) return 100;
  if ([...interest].every((concept) => BROAD.has(concept))) return 100;
  return 0;
}

/** A score saved on the rotation replaces the name match for that interest. */
export function careerMatchScore(
  interestId: string,
  interestName: string,
  rotation: Pick<Rotation, "name" | "careerRelevance">,
): number {
  const manual = rotation.careerRelevance.find((item) => item.interestId === interestId);
  if (manual) return Math.max(0, manual.score);
  return inferredCareerScore(interestName, rotation.name);
}

export function matchingRotationNames(
  interestId: string,
  interestName: string,
  rotations: Array<Pick<Rotation, "name" | "careerRelevance">>,
): string[] {
  return rotations
    .filter((rotation) => careerMatchScore(interestId, interestName, rotation) > 0)
    .map((rotation) => rotation.name)
    .sort((left, right) => left.localeCompare(right));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/pm\s*&\s*r/g, "pmr")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
