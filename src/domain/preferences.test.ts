import { describe, expect, it } from "vitest";
import type { Resident, Rotation } from "./types";
import { rotationPreferencePoints } from "./preferences";

function person(careerInterests: Resident["careerInterests"]): Resident {
  return { careerInterests, electivePreferences: [] } as unknown as Resident;
}

function rotation(name: string, careerRelevance: Rotation["careerRelevance"] = []): Rotation {
  return { id: "rotation", name, careerRelevance } as unknown as Rotation;
}

describe("rotation preference points", () => {
  it("uses the rotation name when nobody entered a score", () => {
    const resident = person([{ interestId: "cardiology", rank: 1 }]);
    const points = rotationPreferencePoints(resident, rotation("Outpt Cards"), [
      { id: "cardiology", name: "Cardiology" },
    ]);
    expect(points).toBe(1000);
  });

  it("keeps a score entered on the rotation ahead of the name match", () => {
    const resident = person([{ interestId: "cardiology", rank: 1 }]);
    const points = rotationPreferencePoints(
      resident,
      rotation("Cardiac ICU", [{ interestId: "cardiology", score: 70 }]),
      [{ id: "cardiology", name: "Cardiology" }],
    );
    expect(points).toBe(700);
  });

  it("reads a custom interest name for any specialty", () => {
    const resident = person([{ interestId: "interest-ortho", rank: 1 }]);
    const points = rotationPreferencePoints(resident, rotation("Ortho Trauma"), [
      { id: "interest-ortho", name: "Orthopedic Surgery" },
    ]);
    expect(points).toBe(1000);
    expect(rotationPreferencePoints(resident, rotation("General Surgery"), [
      { id: "interest-ortho", name: "Orthopedic Surgery" },
    ])).toBe(0);
  });
});
