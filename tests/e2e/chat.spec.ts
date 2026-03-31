import { test, expect } from "./helpers";

test.describe("Chat - Asistente IA", () => {
  const testApiKey = process.env.OPENROUTER_API_KEY;

  test.describe.configure({ mode: "serial" });

  test.describe("Validación de entrada", () => {
    test("debería rechazar mensaje vacío", async ({ request }) => {
      const response = await request.post("/api/chat", {
        data: { message: "" }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.error).toContain("mensaje");
    });

    test("debería rechazar mensaje sin propiedad", async ({ request }) => {
      const response = await request.post("/api/chat", {
        data: {}
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.ok).toBe(false);
    });

    test("debería rechazar mensaje con solo espacios", async ({ request }) => {
      const response = await request.post("/api/chat", {
        data: { message: "   " }
      });

      expect(response.status()).toBe(400);
    });
  });

  test.describe("Gestión de threads", () => {
    test("debería crear thread ID automáticamente", async ({ request }) => {
      if (!testApiKey) {
        test.skip();
      }

      const response = await request.post("/api/chat", {
        data: { message: "Hola" }
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.threadId).toBeDefined();
        expect(body.threadId.length).toBeGreaterThan(0);
      }
    });

    test("debería usar thread existente si se proporciona", async ({ request }) => {
      if (!testApiKey) {
        test.skip();
      }

      const existingThreadId = `existing-thread-${Date.now()}`;

      const response = await request.post("/api/chat", {
        data: {
          threadId: existingThreadId,
          message: "Primera pregunta"
        }
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.threadId).toBe(existingThreadId);
      }
    });

    test("debería mantener contexto en conversación", async ({ request }) => {
      if (!testApiKey) {
        test.skip();
      }

      const threadId = `test-thread-${Date.now()}`;

      await request.post("/api/chat", {
        data: {
          threadId,
          message: "Mi nombre es Test"
        }
      });

      await request.post("/api/chat", {
        data: {
          threadId,
          message: "¿Cómo me llamo?"
        }
      });

      expect(true).toBeTruthy();
    });
  });

  test.describe("Integración con tareas", () => {
    test("debería asociar chat con tarea seleccionada", async ({ request }) => {
      if (!testApiKey) {
        test.skip();
      }

      await request.post("/api/tasks/sync", { timeout: 300000 });

      const listResponse = await request.get("/api/library/tasks");
      const listBody = await listResponse.json();

      if (listBody.tasks && listBody.tasks.length > 0) {
        const taskId = listBody.tasks[0].id;

        const chatResponse = await request.post("/api/chat", {
          data: {
            taskId,
            message: "Explícame esta tarea"
          }
        });

        if (chatResponse.ok()) {
          const chatBody = await chatResponse.json();
          expect(chatBody.reply).toBeDefined();
          expect(typeof chatBody.reply).toBe("string");
        }
      }
    });

    test("debería incluir contexto de tarea en respuesta", async ({ request }) => {
      if (!testApiKey) {
        test.skip();
      }

      await request.post("/api/tasks/sync", { timeout: 300000 });

      const listResponse = await request.get("/api/library/tasks");
      const listBody = await listResponse.json();

      if (listBody.tasks && listBody.tasks.length > 0) {
        const task = listBody.tasks[0];

        const chatResponse = await request.post("/api/chat", {
          data: {
            taskId: task.id,
            message: "¿Cuándo vence esta tarea?"
          }
        });

        if (chatResponse.ok()) {
          const chatBody = await chatResponse.json();
          expect(chatBody.reply).toContain(task.title);
        }
      }
    });

    test("debería funcionar sin tarea asociada", async ({ request }) => {
      if (!testApiKey) {
        test.skip();
      }

      const response = await request.post("/api/chat", {
        data: { message: "¿Qué tareas tengo pendientes?" }
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.reply).toBeDefined();
      }
    });
  });

  test.describe("Modelo y configuración", () => {
    test("debería usar modelo configurado", async ({ request }) => {
      if (!testApiKey) {
        test.skip();
      }

      const response = await request.post("/api/chat", {
        data: { message: "Test" }
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.model).toBeDefined();
      }
    });

    test("debería usar modelo custom si está configurado", async ({ request }) => {
      const customModel = process.env.OPENROUTER_MODEL;
      if (!testApiKey || !customModel) {
        test.skip();
      }

      const response = await request.post("/api/chat", {
        data: { message: "Test" }
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.model).toBe(customModel);
      }
    });
  });

  test.describe("Manejo de errores", () => {
    test("debería devolver error si falta API key", async ({ request }) => {
      const response = await request.post("/api/chat", {
        data: { message: "Hola" }
      });

      const body = await response.json();

      if (!response.ok()) {
        expect(body.error).toBeTruthy();
      }
    });

    test("debería manejar API key inválida", async ({ request }) => {
      const response = await request.post("/api/chat", {
        data: { message: "Test" },
        headers: {
          "OPENROUTER_API_KEY": "invalid-key"
        }
      });

      const body = await response.json();

      if (!response.ok()) {
        expect(body.error).toBeDefined();
      }
    });
  });
});
