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

const app = express();
const store = new SnapshotStore(DATA_DIR);
const database = new BlackboardDatabase(DATA_DIR);
const syncService = new SyncService(DATA_DIR, store, database);
const assistantService = new TaskAssistantService(DATA_DIR, database);

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

app.get("/api/library/tasks", async (_request, response) => {
  response.json({
    ok: true,
    tasks: assistantService.listTasks()
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
  const url = typeof request.body?.url === "string" ? request.body.url.trim() : "";

  if (!url) {
    response.status(400).json({
      ok: false,
      error: "Necesito una URL de Blackboard para leer el detalle de la tarea."
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
});

const shutdown = () => {
  database.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
