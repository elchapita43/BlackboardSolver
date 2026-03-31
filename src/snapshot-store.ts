import fs from "node:fs/promises";
import path from "node:path";
import type { StoredSnapshot, SyncResult } from "./types";

export class SnapshotStore {
  constructor(private readonly dataDir: string) {}

  async readLatest(): Promise<StoredSnapshot | null> {
    try {
      const contents = await fs.readFile(this.snapshotPath, "utf8");
      return JSON.parse(contents) as StoredSnapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async write(result: SyncResult): Promise<StoredSnapshot> {
    await fs.mkdir(this.dataDir, { recursive: true });

    const snapshot: StoredSnapshot = {
      ...result,
      savedAt: new Date().toISOString()
    };

    await fs.writeFile(this.snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
    return snapshot;
  }

  private get snapshotPath(): string {
    return path.join(this.dataDir, "latest-tasks.json");
  }
}

