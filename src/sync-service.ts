import type { StoredSnapshot, TaskDetailHydrationStatus } from "./types";
import { hydrateTaskDetailsFromCalendar, syncPendingTasks } from "./blackboard/scraper";
import { BlackboardDatabase } from "./database";
import { SnapshotStore } from "./snapshot-store";

export class SyncService {
  private currentRun: Promise<StoredSnapshot> | null = null;
  private detailHydrationRun: Promise<void> | null = null;
  private detailHydrationStatus: TaskDetailHydrationStatus = {
    isRunning: false,
    total: 0,
    completed: 0,
    failed: 0,
    failures: []
  };

  constructor(
    private readonly dataDir: string,
    private readonly store: SnapshotStore,
    private readonly database: BlackboardDatabase
  ) {}

  async getLatestSnapshot(): Promise<StoredSnapshot | null> {
    const snapshot = await this.store.readLatest();
    if (snapshot) {
      this.startDetailHydration(snapshot.tasks);
    }

    return snapshot;
  }

  getDetailHydrationStatus(): TaskDetailHydrationStatus {
    return {
      ...this.detailHydrationStatus,
      failures: [...this.detailHydrationStatus.failures]
    };
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

  async refreshLibrary(): Promise<{
    snapshot: StoredSnapshot;
    hydration: TaskDetailHydrationStatus;
  }> {
    const snapshot = await this.sync();
    if (this.detailHydrationRun) {
      await this.detailHydrationRun.catch(() => {
        // Hydration status is exposed below.
      });
    }

    return {
      snapshot,
      hydration: this.getDetailHydrationStatus()
    };
  }

  private async runSync(): Promise<StoredSnapshot> {
    const result = await syncPendingTasks(this.dataDir);
    this.database.upsertTasks(result.tasks, result.finishedAt);
    this.startDetailHydration(result.tasks);
    return this.store.write(result);
  }

  private startDetailHydration(snapshotTasks: StoredSnapshot["tasks"]): void {
    const tasksToHydrate = snapshotTasks.filter((task) => {
      const detail = this.database.getTaskDetail(task.id);
      if (!detail) {
        return true;
      }

      return detail.attachments.some(
        (attachment) =>
          Boolean(attachment.url) &&
          (!attachment.ingestionStatus ||
            attachment.ingestionStatus === "detected" ||
            attachment.ingestionStatus === "downloaded" ||
            attachment.ingestionStatus === "failed")
      );
    });
    if (tasksToHydrate.length === 0 || this.detailHydrationRun) {
      return;
    }

    const startedAt = new Date().toISOString();
    this.detailHydrationStatus = {
      isRunning: true,
      total: tasksToHydrate.length,
      completed: 0,
      failed: 0,
      startedAt,
      finishedAt: undefined,
      lastError: undefined,
      failures: []
    };

    this.detailHydrationRun = this.runDetailHydration(tasksToHydrate);
    this.detailHydrationRun.finally(() => {
      this.detailHydrationRun = null;
    }).catch(() => {
      // Status is updated inside runDetailHydration.
    });
  }

  private async runDetailHydration(tasks: StoredSnapshot["tasks"]): Promise<void> {
    try {
      const result = await hydrateTaskDetailsFromCalendar(this.dataDir, tasks, {
        onProgress: (progress) => {
          this.detailHydrationStatus = {
            ...this.detailHydrationStatus,
            completed: progress.completed,
            failed: progress.failed,
            failures: progress.failures
          };
        }
      });

      for (const detail of result.details) {
        this.database.upsertTaskDetail(detail);
      }

      this.detailHydrationStatus = {
        ...this.detailHydrationStatus,
        isRunning: false,
        completed: tasks.length,
        failed: result.failures.length,
        finishedAt: new Date().toISOString(),
        lastError: result.warnings.at(-1),
        failures: result.failures
      };
    } catch (error) {
      this.detailHydrationStatus = {
        ...this.detailHydrationStatus,
        isRunning: false,
        finishedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
