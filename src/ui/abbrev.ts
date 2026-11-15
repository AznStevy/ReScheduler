import type { Rotation, RotationCategory } from "@/domain/types";

const KNOWN: Record<string, string> = {
  wards: "WARD",
  micu: "MICU",
  cicu: "CICU",
  nf: "NF",
  em: "EM",
  amb: "AMB",
  cards: "CARD",
  gi: "GI",
  pulm: "PULM",
  neph: "NEPH",
  id: "ID",
  research: "RES",
  elective: "ELEC",
  vacation: "VAC",
  icu: "ICU",
};

const CATEGORY_BG: Record<RotationCategory, string> = {
  ward: "#F3E8E3",
  icu: "#F3E4E4",
  night: "#E4E8EE",
  ambulatory: "#E4EDE8",
  emergency: "#F4EBDD",
  elective: "#E6EEF2",
  research: "#E8EAEC",
  vacation: "#F3EFE4",
  other: "#EEF1F2",
};

export function rotationAbbrev(rotation: Pick<Rotation, "id" | "name">): string {
  if (KNOWN[rotation.id]) return KNOWN[rotation.id];
  const initials = rotation.name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return (initials || rotation.name).replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 4) || "ROT";
}

export function categoryBackground(category: RotationCategory): string {
  return CATEGORY_BG[category];
}
