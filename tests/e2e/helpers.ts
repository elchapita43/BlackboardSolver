import { test as base, expect, type Page, type APIRequestContext } from "@playwright/test";

export interface TaskFixture {
  createMockTask: () => Promise<{ id: string; taskId: string }>;
  cleanupMockTasks: () => Promise<void>;
}

export const test = base.extend<TaskFixture>({
  createMockTask: async ({ request }: { request: APIRequestContext }, use: (fn: () => Promise<{ id: string; taskId: string }>) => void) => {
    const createdTasks: string[] = [];

    const createTask = async (): Promise<{ id: string; taskId: string }> => {
      const mockTaskId = `test-task-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const mockUrl = `https://test.blackboard.com/ultra/test/${mockTaskId}`;

      const response = await request.post("/api/library/fetch-detail", {
        data: {
          taskId: mockTaskId,
          url: mockUrl
        }
      });

      if (response.ok()) {
        const data = await response.json();
        createdTasks.push(data.detail?.taskId ?? mockTaskId);
        return { id: mockTaskId, taskId: data.detail?.taskId ?? mockTaskId };
      }

      return { id: mockTaskId, taskId: mockTaskId };
    };

    await use(createTask);

    for (const taskId of createdTasks) {
      try {
        await request.get(`/api/library/tasks/${taskId}`);
      } catch {
        // Best effort cleanup
      }
    }
  },

  cleanupMockTasks: async ({ request }: { request: APIRequestContext }, use: (fn: () => Promise<void>) => void) => {
    await use(async () => {
      const response = await request.get("/api/library/tasks");
      if (response.ok()) {
        const data = await response.json();
        const testTasks = data.tasks?.filter((task: { id: string }) => task.id.startsWith("test-task-")) ?? [];
        for (const task of testTasks) {
          try {
            await request.get(`/api/library/tasks/${task.id}`);
          } catch {
            // Best effort cleanup
          }
        }
      }
    });
  }
});

export { expect, Page, APIRequestContext };
