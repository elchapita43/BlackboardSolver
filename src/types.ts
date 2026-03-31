export type TaskStatus = "pending" | "upcoming" | "overdue" | "unknown";

export interface PendingTask {
  id: string;
  title: string;
  course?: string;
  dueText?: string;
  dueAt?: string;
  description?: string;
  url?: string;
  status: TaskStatus;
  sourcePage: string;
  rawText: string;
}

export interface TaskRecord extends PendingTask {
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface TaskAttachment {
  name: string;
  url?: string;
  kind?: string;
}

export interface TaskMetadataItem {
  label: string;
  value: string;
}

export interface TaskDetail {
  taskId: string;
  taskUrl: string;
  title?: string;
  course?: string;
  instructionsText: string;
  instructionsHtml?: string;
  rawText: string;
  attachments: TaskAttachment[];
  metadata: TaskMetadataItem[];
  htmlPath?: string;
  screenshotPath?: string;
  scrapedAt: string;
}

export interface TaskDetailHydrationFailure {
  taskId: string;
  message: string;
}

export interface TaskDetailHydrationStatus {
  isRunning: boolean;
  total: number;
  completed: number;
  failed: number;
  startedAt?: string;
  finishedAt?: string;
  lastError?: string;
  failures: TaskDetailHydrationFailure[];
}

export interface ChatMessage {
  id: number;
  threadId: string;
  taskId?: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ScrapeSourceResult {
  label: string;
  url: string;
  taskCount: number;
  htmlPath?: string;
  screenshotPath?: string;
  warning?: string;
}

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  requiresManualLogin: boolean;
  tasks: PendingTask[];
  warnings: string[];
  sources: ScrapeSourceResult[];
}

export interface StoredSnapshot extends SyncResult {
  savedAt: string;
}
