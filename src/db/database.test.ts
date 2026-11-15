import { clearSnapshot, loadSnapshot, saveSnapshot } from "@/db/database";
import { buildInternalMedicineDemo, snapshotOf } from "@/data/scenarios";
import { describe, expect, it } from "vitest";

describe("browser storage", () => {
  it("saves and reloads a project snapshot", async () => {
    await clearSnapshot();
    const snapshot = snapshotOf(buildInternalMedicineDemo());
    snapshot.audit.push({ id: "a1", at: "2026-11-12T00:00:00.000Z", action: "note", detail: "saved" });
    await saveSnapshot(snapshot);
    const loaded = await loadSnapshot();
    expect(loaded?.project.residents).toHaveLength(60);
    expect(loaded?.audit[0]?.detail).toBe("saved");
    await clearSnapshot();
    expect(await loadSnapshot()).toBeNull();
  });
});
