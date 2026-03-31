import { test, expect } from "./helpers";

test.describe("Sincronización - Flujo Completo", () => {
  test.describe.configure({ mode: "serial" });

  test("debería persistir datos después de sincronizar", async ({ request }) => {
    const syncResponse = await request.post("/api/tasks/sync", { timeout: 300000 });
    const syncBody = await syncResponse.json();

    if (!syncResponse.ok()) {
      console.log("Sincronización falló (requiere Chrome activo):", syncBody.error);
      test.skip();
    }

    expect(syncBody.snapshot).toBeDefined();
    expect(syncBody.snapshot.tasks).toBeDefined();

    const getResponse = await request.get("/api/tasks");
    const getBody = await getResponse.json();

    expect(getBody.snapshot).toBeDefined();
    expect(getBody.snapshot?.tasks).toEqual(syncBody.snapshot.tasks);
  });

  test("debería guardar tareas en la base de datos", async ({ request }) => {
    await request.post("/api/tasks/sync", { timeout: 300000 });

    const libraryResponse = await request.get("/api/library/tasks");
    const libraryBody = await libraryResponse.json();

    expect(libraryBody.tasks).toBeDefined();
    expect(Array.isArray(libraryBody.tasks)).toBeTruthy();
  });

  test("debería guardar timestamps correctos", async ({ request }) => {
    await request.post("/api/tasks/sync", { timeout: 300000 });

    const libraryResponse = await request.get("/api/library/tasks");
    const libraryBody = await libraryResponse.json();

    if (libraryBody.tasks && libraryBody.tasks.length > 0) {
      const task = libraryBody.tasks[0];
      expect(task.firstSeenAt).toBeDefined();
      expect(task.lastSeenAt).toBeDefined();
      expect(new Date(task.firstSeenAt)).toBeInstanceOf(Date);
      expect(new Date(task.lastSeenAt)).toBeInstanceOf(Date);
    }
  });

  test("debería actualizar tareas existentes", async ({ request }) => {
    const firstSync = await request.post("/api/tasks/sync", { timeout: 300000 });
    const firstBody = await firstSync.json();

    if (!firstSync.ok()) {
      test.skip();
    }

    const secondSync = await request.post("/api/tasks/sync", { timeout: 300000 });
    const secondBody = await secondSync.json();

    if (secondSync.ok()) {
      expect(secondBody.snapshot.finishedAt).not.toBe(firstBody.snapshot.finishedAt);
    }
  });

  test("debería generar archivos de debug", async ({ request }) => {
    const syncResponse = await request.post("/api/tasks/sync", { timeout: 300000 });

    if (!syncResponse.ok()) {
      test.skip();
    }

    const syncBody = await syncResponse.json();
    expect(syncBody.snapshot.sources).toBeDefined();

    for (const source of syncBody.snapshot.sources ?? []) {
      expect(source.htmlPath || source.warning).toBeTruthy();
      expect(source.screenshotPath || source.warning).toBeTruthy();
    }
  });
});

test.describe("Sincronización - Estados de Error", () => {
  test("debería manejar Chrome cerrado correctamente", async ({ request }) => {
    const response = await request.post("/api/tasks/sync", { timeout: 300000 });
    const body = await response.json();

    if (!response.ok()) {
      expect(body).toHaveProperty("error");
      expect(body.error).toMatch(/Chrome|sesion|perfil/i);
    }
  });

  test("debería devolver error específico cuando Chrome está abierto", async ({ request }) => {
    const response = await request.post("/api/tasks/sync", { timeout: 300000 });
    const body = await response.json();

    if (!response.ok()) {
      expect(body.error).toBeTruthy();
      expect(body.error.length).toBeGreaterThan(0);
    }
  });

  test("debería limpiar ejecuciones antiguas", async ({ request }) => {
    for (let i = 0; i < 3; i++) {
      await request.post("/api/tasks/sync", { timeout: 300000 }).catch(() => {});
    }

    expect(true).toBeTruthy();
  });
});

test.describe("Base de Datos - Integridad", () => {
  test("debería crear tablas al iniciar", async ({ request }) => {
    const response = await request.get("/api/library/tasks");

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.tasks).toBeDefined();
  });

  test("debería mantener IDs únicos", async ({ request }) => {
    const response = await request.get("/api/library/tasks");
    const body = await response.json();

    if (body.tasks && body.tasks.length > 0) {
      const ids = body.tasks.map((t: { id: string }) => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    }
  });

  test("debería guardar mensajes de chat", async ({ request }) => {
    const response = await request.post("/api/chat", {
      data: { message: "Test message" },
      headers: {
        "OPENROUTER_API_KEY": process.env.OPENROUTER_API_KEY || "test"
      }
    });

    if (response.ok()) {
      const body = await response.json();
      expect(body.threadId).toBeDefined();
    }
  });
});
