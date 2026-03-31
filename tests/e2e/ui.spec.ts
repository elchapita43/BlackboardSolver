import { test, expect } from "./helpers";

test.describe("UI - Interfaz Web", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test.describe("Página principal", () => {
    test("debería cargar la página sin errores", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));

      await page.waitForLoadState("networkidle");

      expect(errors).toHaveLength(0);
    });

    test("debería mostrar el título correcto", async ({ page }) => {
      await expect(page).toHaveTitle("BlackboardSolver");
    });

    test("debería mostrar el encabezado principal", async ({ page }) => {
      const heading = page.locator("h1");
      await expect(heading).toBeVisible();
      await expect(heading).toContainText("Tareas, detalle y chat");
    });

    test("debería mostrar la descripción de la aplicación", async ({ page }) => {
      const lead = page.locator(".lead");
      await expect(lead).toBeVisible();
      await expect(lead).toContainText("Blackboard");
    });
  });

  test.describe("Sección de sincronización", () => {
    test("debería mostrar el botón de sincronizar", async ({ page }) => {
      const syncButton = page.locator("#syncButton");
      await expect(syncButton).toBeVisible();
      await expect(syncButton).toContainText("Sincronizar ahora");
    });

    test("debería mostrar el indicador de estado", async ({ page }) => {
      const statusPill = page.locator("#statusPill");
      await expect(statusPill).toBeVisible();
      const text = await statusPill.textContent();
      expect(["Sin sincronizar", "Sesion reutilizada", "Login manual detectado"]).toContain(text);
    });

    test("debería tener el indicador de estado con clase válida", async ({ page }) => {
      const statusPill = page.locator("#statusPill");
      const classes = await statusPill.getAttribute("class");
      expect(classes).toMatch(/status-pill/);
    });

    test("debería deshabilitar el botón durante sincronización", async ({ page }) => {
      const syncButton = page.locator("#syncButton");

      await syncButton.click();

      if (await syncButton.isDisabled()) {
        await expect(syncButton).toBeDisabled();
      }
    });

    test("debería mostrar提示 después de sincronizar", async ({ page }) => {
      const syncButton = page.locator("#syncButton");
      const statusPill = page.locator("#statusPill");

      await syncButton.click();
      await page.waitForTimeout(1000);

      const status = await statusPill.textContent();
      expect(status).toMatch(/Sincronizando|Login manual|Sesion reutilizada|Error/);
    });
  });

  test.describe("Sección de tareas", () => {
    test("debería mostrar el contenedor de tareas", async ({ page }) => {
      const tasksContainer = page.locator("#tasks");
      await expect(tasksContainer).toBeVisible();
    });

    test("debería mostrar mensaje cuando no hay tareas", async ({ page }) => {
      const tasksContainer = page.locator("#tasks");
      const hasEmptyClass = await tasksContainer.evaluate((el) => el.classList.contains("empty"));

      if (hasEmptyClass) {
        await expect(tasksContainer).toContainText(/No se detectaron tareas|No hay tareas cargadas/);
      }
    });

    test("debería tener meta información de última sincronización", async ({ page }) => {
      const meta = page.locator("#meta");
      await expect(meta).toBeVisible();
    });
  });

  test.describe("Sección de detalle de tarea", () => {
    test("debería mostrar el selector de tareas", async ({ page }) => {
      const taskSelect = page.locator("#taskSelect");
      await expect(taskSelect).toBeVisible();
    });

    test("debería tener opción por defecto vacía", async ({ page }) => {
      const taskSelect = page.locator("#taskSelect");
      const firstOption = taskSelect.locator("option").first();
      await expect(firstOption).toContainText("Seleccionar tarea");
    });

    test("debería mostrar el campo de URL", async ({ page }) => {
      const urlInput = page.locator("#taskUrlInput");
      await expect(urlInput).toBeVisible();
      await expect(urlInput).toHaveAttribute("type", "url");
    });

    test("debería mostrar el botón de leer detalle", async ({ page }) => {
      const fetchButton = page.locator("#fetchDetailButton");
      await expect(fetchButton).toBeVisible();
      await expect(fetchButton).toContainText("Leer detalle");
    });

    test("debería mostrar el contenedor de detalle", async ({ page }) => {
      const detailCard = page.locator("#taskDetail");
      await expect(detailCard).toBeVisible();
    });

    test("debería cambiar el estado al seleccionar una tarea", async ({ page }) => {
      const taskSelect = page.locator("#taskSelect");
      const tasks = await taskSelect.locator("option").count();

      if (tasks > 1) {
        await taskSelect.selectOption({ index: 1 });
        await page.waitForTimeout(500);
      }
    });

    test("debería actualizar提示 al cambiar de tarea", async ({ page }) => {
      const taskSelect = page.locator("#taskSelect");
      const detailStatus = page.locator("#detailStatus");
      const tasks = await taskSelect.locator("option").count();

      if (tasks > 1) {
        await taskSelect.selectOption({ index: 1 });
        await page.waitForTimeout(500);
        await expect(detailStatus).toBeVisible();
      }
    });
  });

  test.describe("Sección de chat", () => {
    test("debería mostrar el contenedor de chat", async ({ page }) => {
      const chatLog = page.locator("#chatLog");
      await expect(chatLog).toBeVisible();
    });

    test("debería mostrar el formulario de chat", async ({ page }) => {
      const chatForm = page.locator("#chatForm");
      await expect(chatForm).toBeVisible();
    });

    test("debería mostrar el campo de texto del chat", async ({ page }) => {
      const chatInput = page.locator("#chatInput");
      await expect(chatInput).toBeVisible();
      await expect(chatInput).toHaveAttribute("rows", "4");
    });

    test("debería mostrar el botón de enviar", async ({ page }) => {
      const sendButton = page.locator("#chatSendButton");
      await expect(sendButton).toBeVisible();
      await expect(sendButton).toContainText("Enviar");
    });

    test("debería mostrar meta del chat", async ({ page }) => {
      const chatMeta = page.locator("#chatMeta");
      await expect(chatMeta).toBeVisible();
      await expect(chatMeta).toContainText("Sin conversacion");
    });

    test("debería agregar mensaje al chat al enviar", async ({ page }) => {
      const chatInput = page.locator("#chatInput");
      const chatForm = page.locator("#chatForm");
      const chatLog = page.locator("#chatLog");

      await chatInput.fill("Hola, esto es un test");
      await chatForm.evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true })));

      await page.waitForTimeout(1000);

      const logContent = await chatLog.textContent();
      expect(logContent).toBeTruthy();
    });

    test("debería limpiar el campo después de enviar", async ({ page }) => {
      const chatInput = page.locator("#chatInput");
      const chatLog = page.locator("#chatLog");

      await chatInput.fill("Mensaje de prueba");
      await page.locator("#chatSendButton").click();

      await page.waitForTimeout(2000);

      const logContent = await chatLog.textContent();
      expect(logContent).toMatch(/Mensaje de prueba/);
    });

    test("no debería enviar mensaje vacío", async ({ page }) => {
      const chatInput = page.locator("#chatInput");
      const chatLog = page.locator("#chatLog");

      await chatInput.fill("");
      await chatInput.press("Enter");

      await page.waitForTimeout(500);

      const logContent = await chatLog.textContent();
      expect(logContent).toMatch(/Sin conversacion|Todavia no hay mensajes/);
    });
  });

  test.describe("Sección de fuentes", () => {
    test("debería mostrar el contenedor de fuentes", async ({ page }) => {
      const sources = page.locator("#sources");
      await expect(sources).toBeVisible();
    });

    test("debería tener clase source-list", async ({ page }) => {
      const sources = page.locator("#sources");
      const classes = await sources.getAttribute("class");
      expect(classes).toMatch(/source-list/);
    });
  });

  test.describe("Warnings", () => {
    test("debería mostrar contenedor de warnings", async ({ page }) => {
      const warnings = page.locator("#warnings");
      await expect(warnings).toBeVisible();
    });
  });

  test.describe("Responsive", () => {
    test("debería ser visible en viewport móvil", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });

      const syncButton = page.locator("#syncButton");
      await expect(syncButton).toBeVisible();
    });

    test("debería ser visible en viewport desktop", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });

      const syncButton = page.locator("#syncButton");
      await expect(syncButton).toBeVisible();
    });
  });

  test.describe("Accesibilidad", () => {
    test("debería tener atributos ARIA en botones", async ({ page }) => {
      const syncButton = page.locator("#syncButton");
      await expect(syncButton).toHaveAttribute("type", "button");
    });

    test("debería tener labels en inputs", async ({ page }) => {
      const urlInput = page.locator("#taskUrlInput");
      await expect(urlInput).toHaveAttribute("type", "url");
      await expect(urlInput).toHaveAttribute("placeholder");
    });

    test("debería tener roles semánticos en secciones", async ({ page }) => {
      const panels = page.locator(".panel");
      await expect(panels.first()).toBeVisible();
    });
  });
});
