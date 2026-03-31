import type { StoredSnapshot } from "./types";
import { syncPendingTasks } from "./blackboard/scraper";
import { BlackboardDatabase } from "./database";
import { SnapshotStore } from "./snapshot-store";

export class SyncService {
  private currentRun: Promise<StoredSnapshot> | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly store: SnapshotStore,
    private readonly database: BlackboardDatabase
  ) {}

  async getLatestSnapshot(): Promise<StoredSnapshot | null> {
    return this.store.readLatest();
  }

  async sync(): Promise<StoredSnapshot> {
    if (!this.currentRun) {
      this.currentRun = this.runSync();
      this.currentRun.finally(() => {
        this.currentRun = null;
      }).catch(() => {
        // The request handler reports the error.
      });
    }

    return this.currentRun;
  }

  private async runSync(): Promise<StoredSnapshot> {
    const result = await syncPendingTasks(this.dataDir);
    this.database.upsertTasks(result.tasks, result.finishedAt);
    return this.store.write(result);
  }
}
