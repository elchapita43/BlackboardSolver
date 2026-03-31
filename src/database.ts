import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ChatMessage, PendingTask, TaskDetail, TaskRecord } from "./types";

interface TaskRow {
  id: string;
  title: string;
  course: string | null;
  due_text: string | null;
  due_at: string | null;
  description: string | null;
  url: string | null;
  status: PendingTask["status"];
  source_page: string;
  raw_text: string;
  first_seen_at: string;
  last_seen_at: string;
}

interface TaskDetailRow {
  task_id: string;
  task_url: string;
  title: string | null;
  course: string | null;
  instructions_text: string;
  instructions_html: string | null;
  raw_text: string;
  attachments_json: string;
  metadata_json: string;
  html_path: string | null;
  screenshot_path: string | null;
  scraped_at: string;
}

interface ChatMessageRow {
  id: number;
  thread_id: string;
  task_id: string | null;
  role: ChatMessage["role"];
  content: string;
  created_at: string;
}

export class BlackboardDatabase {
  private readonly database: Database.Database;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.database = new Database(path.join(dataDir, "blackboard.db"));
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.initialize();
  }

  upsertTasks(tasks: PendingTask[], syncedAt: string): void {
    const statement = this.database.prepare(`
      INSERT INTO tasks (
        id, title, course, due_text, due_at, description, url, status, source_page, raw_text, first_seen_at, last_seen_at
      ) VALUES (
        @id, @title, @course, @due_text, @due_at, @description, @url, @status, @source_page, @raw_text, @synced_at, @synced_at
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        course = excluded.course,
        due_text = excluded.due_text,
        due_at = excluded.due_at,
        description = excluded.description,
        url = COALESCE(excluded.url, tasks.url),
        status = excluded.status,
        source_page = excluded.source_page,
        raw_text = excluded.raw_text,
        last_seen_at = excluded.last_seen_at
    `);
    const transaction = this.database.transaction((items: PendingTask[]) => {
      for (const task of items) {
        statement.run({
          id: task.id,
          title: task.title,
          course: task.course ?? null,
          due_text: task.dueText ?? null,
          due_at: task.dueAt ?? null,
          description: task.description ?? null,
          url: task.url ?? null,
          status: task.status,
          source_page: task.sourcePage,
          raw_text: task.rawText,
          synced_at: syncedAt
        });
      }
    });

    transaction(tasks);
  }

  listTasks(): TaskRecord[] {
    const rows = this.database
      .prepare(`
        SELECT
          t.id,
          t.title,
          t.course,
          t.due_text,
          t.due_at,
          t.description,
          COALESCE(d.task_url, t.url) AS url,
          t.status,
          t.source_page,
          t.raw_text,
          t.first_seen_at,
          t.last_seen_at
        FROM tasks t
        LEFT JOIN task_details d ON d.task_id = t.id
        ORDER BY
          CASE t.status
            WHEN 'overdue' THEN 0
            WHEN 'pending' THEN 1
            WHEN 'upcoming' THEN 2
            ELSE 3
          END,
          t.last_seen_at DESC,
          t.title ASC
      `)
      .all() as TaskRow[];

    return rows.map((row) => this.mapTaskRow(row));
  }

  getTask(taskId: string): TaskRecord | null {
    const row = this.database
      .prepare(`
        SELECT
          t.id,
          t.title,
          t.course,
          t.due_text,
          t.due_at,
          t.description,
          COALESCE(d.task_url, t.url) AS url,
          t.status,
          t.source_page,
          t.raw_text,
          t.first_seen_at,
          t.last_seen_at
        FROM tasks t
        LEFT JOIN task_details d ON d.task_id = t.id
        WHERE t.id = ?
      `)
      .get(taskId) as TaskRow | undefined;

    return row ? this.mapTaskRow(row) : null;
  }

  upsertTaskDetail(detail: TaskDetail): void {
    this.database
      .prepare(`
        INSERT INTO task_details (
          task_id,
          task_url,
          title,
          course,
          instructions_text,
          instructions_html,
          raw_text,
          attachments_json,
          metadata_json,
          html_path,
          screenshot_path,
          scraped_at
        ) VALUES (
          @task_id,
          @task_url,
          @title,
          @course,
          @instructions_text,
          @instructions_html,
          @raw_text,
          @attachments_json,
          @metadata_json,
          @html_path,
          @screenshot_path,
          @scraped_at
        )
        ON CONFLICT(task_id) DO UPDATE SET
          task_url = excluded.task_url,
          title = excluded.title,
          course = excluded.course,
          instructions_text = excluded.instructions_text,
          instructions_html = excluded.instructions_html,
          raw_text = excluded.raw_text,
          attachments_json = excluded.attachments_json,
          metadata_json = excluded.metadata_json,
          html_path = excluded.html_path,
          screenshot_path = excluded.screenshot_path,
          scraped_at = excluded.scraped_at
      `)
      .run({
        task_id: detail.taskId,
        task_url: detail.taskUrl,
        title: detail.title ?? null,
        course: detail.course ?? null,
        instructions_text: detail.instructionsText,
        instructions_html: detail.instructionsHtml ?? null,
        raw_text: detail.rawText,
        attachments_json: JSON.stringify(detail.attachments),
        metadata_json: JSON.stringify(detail.metadata),
        html_path: detail.htmlPath ?? null,
        screenshot_path: detail.screenshotPath ?? null,
        scraped_at: detail.scrapedAt
      });

    this.database
      .prepare(`
        UPDATE tasks
        SET
          url = @task_url,
          title = COALESCE(@title, title),
          course = COALESCE(@course, course),
          description = CASE
            WHEN @instructions_text <> '' THEN @instructions_text
            ELSE description
          END
        WHERE id = @task_id
      `)
      .run({
        task_id: detail.taskId,
        task_url: detail.taskUrl,
        title: detail.title ?? null,
        course: detail.course ?? null,
        instructions_text: detail.instructionsText
      });
  }

  getTaskDetail(taskId: string): TaskDetail | null {
    const row = this.database
      .prepare(
        `
        SELECT
          task_id,
          task_url,
          title,
          course,
          instructions_text,
          instructions_html,
          raw_text,
          attachments_json,
          metadata_json,
          html_path,
          screenshot_path,
          scraped_at
        FROM task_details
        WHERE task_id = ?
      `
      )
      .get(taskId) as TaskDetailRow | undefined;

    return row ? this.mapTaskDetailRow(row) : null;
  }

  saveChatMessage(message: Omit<ChatMessage, "id">): ChatMessage {
    const result = this.database
      .prepare(
        `
        INSERT INTO chat_messages (thread_id, task_id, role, content, created_at)
        VALUES (@thread_id, @task_id, @role, @content, @created_at)
      `
      )
      .run({
        thread_id: message.threadId,
        task_id: message.taskId ?? null,
        role: message.role,
        content: message.content,
        created_at: message.createdAt
      });

    return {
      id: Number(result.lastInsertRowid),
      ...message
    };
  }

  listChatMessages(threadId: string, limit = 24): ChatMessage[] {
    const rows = this.database
      .prepare(
        `
        SELECT id, thread_id, task_id, role, content, created_at
        FROM chat_messages
        WHERE thread_id = ?
        ORDER BY id DESC
        LIMIT ?
      `
      )
      .all(threadId, limit) as ChatMessageRow[];

    return rows.reverse().map((row) => ({
      id: row.id,
      threadId: row.thread_id,
      taskId: row.task_id ?? undefined,
      role: row.role,
      content: row.content,
      createdAt: row.created_at
    }));
  }

  close(): void {
    this.database.close();
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        course TEXT,
        due_text TEXT,
        due_at TEXT,
        description TEXT,
        url TEXT,
        status TEXT NOT NULL,
        source_page TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_details (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        task_url TEXT NOT NULL,
        title TEXT,
        course TEXT,
        instructions_text TEXT NOT NULL,
        instructions_html TEXT,
        raw_text TEXT NOT NULL,
        attachments_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        html_path TEXT,
        screenshot_path TEXT,
        scraped_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  private mapTaskRow(row: TaskRow): TaskRecord {
    return {
      id: row.id,
      title: row.title,
      course: row.course ?? undefined,
      dueText: row.due_text ?? undefined,
      dueAt: row.due_at ?? undefined,
      description: row.description ?? undefined,
      url: row.url ?? undefined,
      status: row.status,
      sourcePage: row.source_page,
      rawText: row.raw_text,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at
    };
  }

  private mapTaskDetailRow(row: TaskDetailRow): TaskDetail {
    return {
      taskId: row.task_id,
      taskUrl: row.task_url,
      title: row.title ?? undefined,
      course: row.course ?? undefined,
      instructionsText: row.instructions_text,
      instructionsHtml: row.instructions_html ?? undefined,
      rawText: row.raw_text,
      attachments: JSON.parse(row.attachments_json) as TaskDetail["attachments"],
      metadata: JSON.parse(row.metadata_json) as TaskDetail["metadata"],
      htmlPath: row.html_path ?? undefined,
      screenshotPath: row.screenshot_path ?? undefined,
      scrapedAt: row.scraped_at
    };
  }
}
