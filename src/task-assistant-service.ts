import crypto from "node:crypto";
import type { PendingTask, TaskDetail, TaskRecord } from "./types";
import { fetchTaskDetail } from "./blackboard/scraper";
import { BlackboardDatabase } from "./database";

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class TaskAssistantService {
  constructor(
    private readonly dataDir: string,
    private readonly database: BlackboardDatabase
  ) {}

  listTasks(): TaskRecord[] {
    return this.database.listTasks();
  }

  getTask(taskId: string): TaskRecord | null {
    return this.database.getTask(taskId);
  }

  getTaskDetail(taskId: string): TaskDetail | null {
    return this.database.getTaskDetail(taskId);
  }

  async fetchAndStoreTaskDetail(input: { taskId?: string; url: string }): Promise<TaskDetail> {
    const taskId = input.taskId ?? this.buildSyntheticTaskId(input.url);
    const existingTask = this.database.getTask(taskId);

    if (!existingTask) {
      const now = new Date().toISOString();
      const placeholder: PendingTask = {
        id: taskId,
        title: input.url,
        url: input.url,
        status: "unknown",
        sourcePage: input.url,
        rawText: input.url
      };
      this.database.upsertTasks([placeholder], now);
    }

    const detail = await fetchTaskDetail(this.dataDir, {
      taskId,
      url: input.url
    });
    this.database.upsertTaskDetail(detail);
    return detail;
  }

  async chat(input: {
    threadId?: string;
    taskId?: string;
    message: string;
  }): Promise<{ threadId: string; reply: string; model: string }> {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("Falta OPENROUTER_API_KEY para usar el modo chat.");
    }

    const threadId = input.threadId?.trim() || crypto.randomUUID();
    const selectedTask = input.taskId ? this.database.getTask(input.taskId) : null;
    const selectedDetail = input.taskId ? this.database.getTaskDetail(input.taskId) : null;
    const recentTasks = this.database.listTasks().slice(0, 12);

    const userMessage = this.database.saveChatMessage({
      threadId,
      taskId: input.taskId,
      role: "user",
      content: input.message,
      createdAt: new Date().toISOString()
    });

    const history = this.database.listChatMessages(threadId, 18);
    const systemPrompt = buildSystemPrompt({
      selectedTask,
      selectedDetail,
      recentTasks
    });
    const messages: OpenRouterMessage[] = [
      { role: "system", content: systemPrompt },
      ...history.map((message) => ({
        role: message.role,
        content: message.content
      }))
    ];

    const model = process.env.OPENROUTER_MODEL?.trim() || "qwen/qwen3.6-plus-preview:free";
    const reply = await requestOpenRouterCompletion(apiKey, model, messages);

    this.database.saveChatMessage({
      threadId,
      taskId: input.taskId,
      role: "assistant",
      content: reply,
      createdAt: new Date().toISOString()
    });

    return {
      threadId,
      reply,
      model
    };
  }

  private buildSyntheticTaskId(url: string): string {
    return `task-${url
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)}`;
  }
}

function buildSystemPrompt(input: {
  selectedTask: TaskRecord | null;
  selectedDetail: TaskDetail | null;
  recentTasks: TaskRecord[];
}): string {
  const taskContext = input.selectedTask
    ? [
        `Tarea seleccionada: ${input.selectedTask.title}`,
        input.selectedTask.course ? `Materia: ${input.selectedTask.course}` : "",
        input.selectedTask.dueText ? `Entrega: ${input.selectedTask.dueText}` : "",
        input.selectedTask.url ? `URL: ${input.selectedTask.url}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    : "No hay una tarea seleccionada.";

  const detailContext = input.selectedDetail
    ? [
        "Detalle scrapeado de la tarea:",
        input.selectedDetail.instructionsText,
        input.selectedDetail.metadata.length > 0
          ? `Metadatos:\n${input.selectedDetail.metadata.map((item) => `- ${item.label}: ${item.value}`).join("\n")}`
          : "",
        input.selectedDetail.attachments.length > 0
          ? `Adjuntos:\n${input.selectedDetail.attachments.map((item) => `- ${item.name}${item.url ? ` (${item.url})` : ""}`).join("\n")}`
          : ""
      ]
        .filter(Boolean)
        .join("\n\n")
    : "No hay detalle scrapeado para la tarea seleccionada.";

  const pendingTasksContext =
    input.recentTasks.length > 0
      ? input.recentTasks
          .map((task, index) => {
            return `${index + 1}. ${task.title}${task.course ? ` | ${task.course}` : ""}${task.dueText ? ` | ${task.dueText}` : ""}`;
          })
          .join("\n")
      : "No hay tareas sincronizadas.";

  return [
    "Sos un asistente para un estudiante de Blackboard Palermo.",
    "Responde en espanol claro y concreto.",
    "Usa solamente el contexto provisto. Si falta informacion, dilo explicitamente.",
    "Si el usuario pide resolver una tarea, ayuda a entenderla, organizar pasos y producir una respuesta trabajada, pero no inventes datos que no aparezcan en la consigna.",
    taskContext,
    detailContext,
    `Tareas recientes:\n${pendingTasksContext}`
  ].join("\n\n");
}

async function requestOpenRouterCompletion(
  apiKey: string,
  model: string,
  messages: OpenRouterMessage[]
): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://127.0.0.1:3010",
      "X-Title": "BlackboardSolver"
    },
    body: JSON.stringify({
      model,
      messages
    })
  });

  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenRouter devolvio ${response.status}.`);
  }

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenRouter no devolvio texto util.");
  }

  return content;
}
