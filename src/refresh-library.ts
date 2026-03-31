import path from "node:path";
import { BlackboardDatabase } from "./database";
import { SnapshotStore } from "./snapshot-store";
import { SyncService } from "./sync-service";

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const dataDir = path.join(rootDir, ".data");
  const store = new SnapshotStore(dataDir);
  const database = new BlackboardDatabase(dataDir);
  const syncService = new SyncService(dataDir, store, database);

  try {
    const result = await syncService.refreshLibrary();
    const detailCount = result.snapshot.tasks.filter((task) => database.getTaskDetail(task.id)).length;

    console.log(
      JSON.stringify(
        {
          ok: true,
          taskCount: result.snapshot.tasks.length,
          detailCount,
          requiresManualLogin: result.snapshot.requiresManualLogin,
          hydration: result.hydration
        },
        null,
        2
      )
    );
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exit(1);
});
