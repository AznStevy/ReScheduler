import Dexie, { type Table } from "dexie";
import type { Snapshot } from "@/domain/types";

interface StoredSnapshot {
  id: "current";
  snapshot: Snapshot;
  savedAt: string;
}

class ReSchedulerDatabase extends Dexie {
  snapshots!: Table<StoredSnapshot, string>;

  constructor() {
    super("rescheduler");
    this.version(1).stores({ snapshots: "id" });
  }
}

export const db = new ReSchedulerDatabase();

export async function loadSnapshot(): Promise<Snapshot | null> {
  const row = await db.snapshots.get("current");
  return row?.snapshot ?? null;
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  await db.snapshots.put({ id: "current", snapshot, savedAt: new Date().toISOString() });
}

export async function clearSnapshot(): Promise<void> {
  await db.snapshots.delete("current");
}
