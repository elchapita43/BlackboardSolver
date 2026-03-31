import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { BlackboardDatabase } from "./database";
import { SnapshotStore } from "./snapshot-store";
import { SyncService } from "./sync-service";
import { TaskAssistantService } from "./task-assistant-service";

const PORT = Number(process.env.PORT ?? "3010");
const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, ".data");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const AUTO_SYNC_INTERVAL_MINUTES = Math.max(0, Number(process.env.BLACKBOARD_AUTO_SYNC_INTERVAL_MINUTES ?? "0"));
const AUTO_SYNC_MAX_AGE_HOURS = Math.max(0, Number(process.env.BLACKBOARD_AUTO_SYNC_MAX_AGE_HOURS ?? "24"));

const app = express();
const store = new SnapshotStore(DATA_DIR);
const database = new BlackboardDatabase(DATA_DIR);
const syncService = new SyncService(DATA_DIR, store, database);
const assistantService = new TaskAssistantService(DATA_DIR, database, store);

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.get("/api/tasks", async (_request, response) => {
  const snapshot = await syncService.getLatestSnapshot();
  response.json({
    ok: true,
    snapshot
  });
});

app.post("/api/tasks/sync", async (_request, response) => {
  try {
    const snapshot = await syncService.sync();
    response.json({
      ok: true,
      snapshot
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(500).json({
      ok: false,
      error: message
    });
  }
});

app.get("/api/tasks/hydration-status", (_request, response) => {
  response.json({
    ok: true,
    status: syncService.getDetailHydrationStatus()
  });
});

app.get("/api/library/tasks", async (_request, response) => {
  response.json({
    ok: true,
    tasks: await assistantService.listTasks()
  });
});

app.get("/api/library/tasks/:taskId", async (request, response) => {
  const task = assistantService.getTask(request.params.taskId);
  if (!task) {
    response.status(404).json({
      ok: false,
      error: "No encontre esa tarea en la base local."
    });
    return;
  }

  response.json({
    ok: true,
    task,
    detail: assistantService.getTaskDetail(task.id)
  });
});

app.post("/api/library/fetch-detail", async (request, response) => {
  const taskId = typeof request.body?.taskId === "string" ? request.body.taskId.trim() : undefined;
  const url = typeof request.body?.url === "string" ? request.body.url.trim() : undefined;

  if (!taskId && !url) {
    response.status(400).json({
      ok: false,
      error: "Necesito una tarea sincronizada o una URL de Blackboard para releer el detalle."
    });
    return;
  }

  try {
    const detail = await assistantService.fetchAndStoreTaskDetail({ taskId, url });
    response.json({
      ok: true,
      detail
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(500).json({
      ok: false,
      error: message
    });
  }
});

app.post("/api/chat", async (request, response) => {
  const taskId = typeof request.body?.taskId === "string" ? request.body.taskId.trim() : undefined;
  const threadId = typeof request.body?.threadId === "string" ? request.body.threadId.trim() : undefined;
  const message = typeof request.body?.message === "string" ? request.body.message.trim() : "";

  if (!message) {
    response.status(400).json({
      ok: false,
      error: "El mensaje no puede estar vacio."
    });
    return;
  }

  try {
    const result = await assistantService.chat({
      threadId,
      taskId,
      message
    });

    response.json({
      ok: true,
      ...result
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    response.status(500).json({
      ok: false,
      error: messageText
    });
  }
});

app.listen(PORT, () => {
  console.log(`BlackboardSolver escuchando en http://127.0.0.1:${PORT}`);
  void startBackgroundRefreshLoop();
});

let backgroundRefreshTimer: NodeJS.Timeout | null = null;
let backgroundRefreshInFlight = false;

async function startBackgroundRefreshLoop(): Promise<void> {
  if (!shouldRunBackgroundRefresh()) {
    console.log("Auto-sync en segundo plano desactivado: no hay credenciales ni sesion persistente.");
    return;
  }

  const run = async (reason: "startup" | "interval"): Promise<void> => {
    if (backgroundRefreshInFlight) {
      return;
    }

    backgroundRefreshInFlight = true;
    try {
      const result = await syncService.refreshLibrary();
      console.log(
        `[auto-sync:${reason}] tareas=${result.snapshot.tasks.length} detalles=${result.hydration.completed - result.hydration.failed}/${result.hydration.total}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[auto-sync:${reason}] ${message}`);
    } finally {
      backgroundRefreshInFlight = false;
    }
  };

  if (await shouldRunStartupRefresh()) {
    setTimeout(() => {
      void run("startup");
    }, 1000);
  } else {
    console.log("Auto-sync de arranque omitido: la snapshot local sigue fresca.");
  }

  if (AUTO_SYNC_INTERVAL_MINUTES <= 0) {
    return;
  }

  backgroundRefreshTimer = setInterval(() => {
    void run("interval");
  }, AUTO_SYNC_INTERVAL_MINUTES * 60 * 1000);
}

function shouldRunBackgroundRefresh(): boolean {
  if (Boolean(process.env.BLACKBOARD_USERNAME?.trim() && process.env.BLACKBOARD_PASSWORD?.trim())) {
    return true;
  }

  return (
    existsSync(path.join(DATA_DIR, "credentials.json")) ||
    existsSync(path.join(DATA_DIR, "browser-profile")) ||
    existsSync(path.join(DATA_DIR, "latest-tasks.json"))
  );
}

async function shouldRunStartupRefresh(): Promise<boolean> {
  const snapshot = await store.readLatest();
  if (!snapshot) {
    return true;
  }

  if (AUTO_SYNC_MAX_AGE_HOURS <= 0) {
    return false;
  }

  const savedAt = Date.parse(snapshot.savedAt);
  if (Number.isNaN(savedAt)) {
    return true;
  }

  const ageMs = Date.now() - savedAt;
  return ageMs >= AUTO_SYNC_MAX_AGE_HOURS * 60 * 60 * 1000;
}

const shutdown = () => {
  if (backgroundRefreshTimer) {
    clearInterval(backgroundRefreshTimer);
  }
  database.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[uncaughtException]", error);
});
