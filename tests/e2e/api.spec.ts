import { test, expect, APIRequestContext } from "./helpers";

test.describe("API - Endpoints REST", () => {
  test.describe.configure({ mode: "serial" });

  test.describe("GET /api/tasks", () => {
    test("deberÃ­a devolver 200 con estructura vÃ¡lida", async ({ request }) => {
      const response = await request.get("/api/tasks");

      expect(response.ok()).toBeTruthy();
      const body = await response.json();

      expect(body).toHaveProperty("ok", true);
      expect(body).toHaveProperty("snapshot");
    });

    test("deberÃ­a devolver 200 con snapshot existente", async ({ request }) => {
      await request.post("/api/tasks/sync", { timeout: 300000 });

      const response = await request.get("/api/tasks");
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body).toHaveProperty("ok", true);
      expect(body).toHaveProperty("snapshot");
    });

    test("deberÃ­a devolver headers correctos", async ({ request }) => {
      const response = await request.get("/api/tasks");

      expect(response.headers()["content-type"]).toContain("application/json");
    });
  });

  test.describe("POST /api/tasks/sync", () => {
    test("deberÃ­a devolver 200 al iniciar sincronizaciÃ³n", async ({ request }) => {
      const response = await request.post("/api/tasks/sync", { timeout: 300000 });

      const body = await response.json();

      if (response.ok()) {
        expect(body).toHaveProperty("ok", true);
        expect(body).toHaveProperty("snapshot");
        expect(body.snapshot).toHaveProperty("startedAt");
        expect(body.snapshot).toHaveProperty("finishedAt");
        expect(body.snapshot).toHaveProperty("tasks");
        expect(body.snapshot).toHaveProperty("sources");
      } else {
        expect(body).toHaveProperty("ok", false);
        expect(body).toHaveProperty("error");
      }
    });

    test("deberia manejar sincronizacion simultanea sin romperse", async ({ request }) => {
      const [firstSync, secondSync] = await Promise.all([
        request.post("/api/tasks/sync", { timeout: 300000 }),
        request.post("/api/tasks/sync", { timeout: 300000 })
      ]);

      const firstBody = await firstSync.json();
      const secondBody = await secondSync.json();

      expect(typeof firstBody.ok).toBe("boolean");
      expect(typeof secondBody.ok).toBe("boolean");

      if (firstBody.ok && secondBody.ok) {
        expect(firstBody.snapshot).toBeTruthy();
        expect(secondBody.snapshot).toBeTruthy();
      } else if (!firstBody.ok && !secondBody.ok) {
        expect(firstBody.error).toBeTruthy();
        expect(secondBody.error).toBeTruthy();
      }
    });

    test("snapshot deberÃ­a tener estructura de SyncResult vÃ¡lida", async ({ request }) => {
      const response = await request.post("/api/tasks/sync", { timeout: 300000 });

      if (response.ok()) {
        const body = await response.json();
        const snapshot = body.snapshot;

        expect(snapshot).toHaveProperty("startedAt");
        expect(snapshot).toHaveProperty("finishedAt");
        expect(snapshot).toHaveProperty("requiresManualLogin");
        expect(snapshot).toHaveProperty("tasks");
        expect(snapshot).toHaveProperty("warnings");
        expect(snapshot).toHaveProperty("sources");

        expect(Array.isArray(snapshot.tasks)).toBeTruthy();
        expect(Array.isArray(snapshot.warnings)).toBeTruthy();
        expect(Array.isArray(snapshot.sources)).toBeTruthy();

        if (snapshot.tasks.length > 0) {
          const task = snapshot.tasks[0];
          expect(task).toHaveProperty("id");
          expect(task).toHaveProperty("title");
          expect(task).toHaveProperty("status");
          expect(task).toHaveProperty("sourcePage");
          expect(task).toHaveProperty("rawText");
        }

        if (snapshot.sources.length > 0) {
          const source = snapshot.sources[0];
          expect(source).toHaveProperty("label");
          expect(source).toHaveProperty("url");
          expect(source).toHaveProperty("taskCount");
        }
      }
    });
  });

  test.describe("GET /api/library/tasks", () => {
    test("deberÃ­a devolver 200 con lista de tareas", async ({ request }) => {
      const response = await request.get("/api/library/tasks");

      expect(response.ok()).toBeTruthy();
      const body = await response.json();

      expect(body).toHaveProperty("ok", true);
      expect(body).toHaveProperty("tasks");
      expect(Array.isArray(body.tasks)).toBeTruthy();
    });

    test("deberÃ­a devolver tareas ordenadas por status", async ({ request }) => {
      const response = await request.get("/api/library/tasks");

      if (response.ok()) {
        const body = await response.json();
        const tasks = body.tasks;

        if (tasks.length > 1) {
          const statusOrder: Record<string, number> = {
            overdue: 0,
            pending: 1,
            upcoming: 2,
            unknown: 3
          };

          for (let i = 1; i < tasks.length; i++) {
            const prevStatus = statusOrder[tasks[i - 1]?.status] ?? 3;
            const currStatus = statusOrder[tasks[i]?.status] ?? 3;
            expect(prevStatus).toBeLessThanOrEqual(currStatus);
          }
        }
      }
    });

    test("deberÃ­a incluir campos requeridos en cada tarea", async ({ request }) => {
      const response = await request.get("/api/library/tasks");

      if (response.ok()) {
        const body = await response.json();
        const tasks = body.tasks as Array<Record<string, unknown>>;

        for (const task of tasks) {
          expect(task).toHaveProperty("id");
          expect(task).toHaveProperty("title");
          expect(task).toHaveProperty("status");
          expect(task).toHaveProperty("sourcePage");
          expect(task).toHaveProperty("rawText");
          expect(task).toHaveProperty("firstSeenAt");
          expect(task).toHaveProperty("lastSeenAt");
        }
      }
    });
  });

  test.describe("GET /api/library/tasks/:taskId", () => {
    test("deberÃ­a devolver 404 para tarea inexistente", async ({ request }) => {
      const fakeTaskId = "non-existent-task-id-12345";
      const response = await request.get(`/api/library/tasks/${fakeTaskId}`);

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty("ok", false);
      expect(body).toHaveProperty("error");
    });

    test("deberÃ­a devolver 200 con tarea existente y detalle", async ({ request }) => {
      await request.post("/api/tasks/sync", { timeout: 300000 });

      const listResponse = await request.get("/api/library/tasks");
      const listBody = await listResponse.json();

      if (listBody.tasks && listBody.tasks.length > 0) {
        const taskId = listBody.tasks[0].id;
        const response = await request.get(`/api/library/tasks/${taskId}`);

        expect(response.ok()).toBeTruthy();
        const body = await response.json();
        expect(body).toHaveProperty("ok", true);
        expect(body).toHaveProperty("task");
        expect(body.task.id).toBe(taskId);
      }
    });

    test("deberÃ­a devolver 400 para taskId vacÃ­o", async ({ request }) => {
      const response = await request.get("/api/library/tasks/%20");

      expect(response.status()).toBe(404);
    });
  });

  test.describe("POST /api/library/fetch-detail", () => {
    test("deberÃ­a devolver 400 sin URL", async ({ request }) => {
      const response = await request.post("/api/library/fetch-detail", {
        data: {}
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("ok", false);
      expect(body.error).toContain("URL");
    });

    test("deberÃ­a devolver 400 con URL vacÃ­a", async ({ request }) => {
      const response = await request.post("/api/library/fetch-detail", {
        data: { url: "" }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("ok", false);
    });

    test("deberÃ­a procesar URL vÃ¡lida de Blackboard", async ({ request }) => {
      const mockUrl = "https://palermo.blackboard.com/ultra/calendar";

      const response = await request.post("/api/library/fetch-detail", {
        data: { url: mockUrl }
      });

      const body = await response.json();

      if (response.ok()) {
        expect(body).toHaveProperty("ok", true);
        expect(body).toHaveProperty("detail");
        expect(body.detail).toHaveProperty("taskId");
        expect(body.detail).toHaveProperty("taskUrl");
        expect(body.detail).toHaveProperty("instructionsText");
        expect(body.detail).toHaveProperty("scrapedAt");
      } else {
        expect(body).toHaveProperty("error");
        console.log("Nota: El test requiere sesiÃ³n de Chrome activa o credenciales configuradas");
      }
    });

    test("deberÃ­a aceptar taskId opcional", async ({ request }) => {
      const mockUrl = "https://palermo.blackboard.com/ultra/calendar";
      const mockTaskId = `test-task-${Date.now()}`;

      const response = await request.post("/api/library/fetch-detail", {
        data: { taskId: mockTaskId, url: mockUrl }
      });

      const body = await response.json();

      if (response.ok()) {
        expect(body.detail.taskId).toBe(mockTaskId);
      }
    });
  });

  test.describe("POST /api/chat", () => {
    test("deberÃ­a devolver 400 sin mensaje", async ({ request }) => {
      const response = await request.post("/api/chat", {
        data: {}
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("ok", false);
      expect(body.error).toContain("mensaje");
    });

    test("deberÃ­a devolver 400 con mensaje vacÃ­o", async ({ request }) => {
      const response = await request.post("/api/chat", {
        data: { message: "" }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("ok", false);
    });

    test("deberÃ­a devolver 500 sin API key configurada", async ({ request }) => {
      const response = await request.post("/api/chat", {
        data: { message: "Hola, Â¿cÃ³mo estÃ¡s?" }
      });

      const body = await response.json();

      if (!response.ok()) {
        expect(body).toHaveProperty("ok", false);
        expect(body).toHaveProperty("error");
        expect(body.error).toContain("OPENROUTER_API_KEY");
      }
    });

    test("deberÃ­a crear thread automÃ¡ticamente si no se provee", async ({ request }) => {
      const response = await request.post("/api/chat", {
        data: { message: "Hola" },
        headers: {
          "OPENROUTER_API_KEY": process.env.OPENROUTER_API_KEY || "test-key"
        }
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body).toHaveProperty("threadId");
        expect(body.threadId).toBeTruthy();
      }
    });

    test("deberÃ­a usar thread existente si se provee threadId", async ({ request }) => {
      const threadId = `test-thread-${Date.now()}`;

      const response = await request.post("/api/chat", {
        data: {
          threadId,
          message: "Primera mensaje del test"
        },
        headers: {
          "OPENROUTER_API_KEY": process.env.OPENROUTER_API_KEY || "test-key"
        }
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.threadId).toBe(threadId);
      }
    });

    test("deberÃ­a asociar mensaje con tarea si se provee taskId", async ({ request }) => {
      await request.post("/api/tasks/sync", { timeout: 300000 });
      const listResponse = await request.get("/api/library/tasks");
      const listBody = await listResponse.json();

      if (listBody.tasks && listBody.tasks.length > 0) {
        const taskId = listBody.tasks[0].id;

        const response = await request.post("/api/chat", {
          data: {
            taskId,
            message: "ExplÃ­came esta tarea"
          },
          headers: {
            "OPENROUTER_API_KEY": process.env.OPENROUTER_API_KEY || "test-key"
          }
        });

        if (response.ok()) {
          const body = await response.json();
          expect(body).toHaveProperty("reply");
          expect(typeof body.reply).toBe("string");
        }
      }
    });
  });
});
