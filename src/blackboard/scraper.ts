import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { PendingTask, ScrapeSourceResult, SyncResult, TaskDetail, TaskStatus } from "../types";

const LOGIN_URL = "https://palermo.blackboard.com/";
const ULTRA_HOME_URL = "https://palermo.blackboard.com/ultra";
const LOGIN_WAIT_TIMEOUT_MS = parseTimeoutMs(
  process.env.BLACKBOARD_LOGIN_WAIT_TIMEOUT_MS,
  3 * 60 * 1000
);

const CANDIDATE_PAGES = [
  { label: "Ultra Home", url: "https://palermo.blackboard.com/ultra" },
  { label: "Activity Stream", url: "https://palermo.blackboard.com/ultra/stream" },
  { label: "Calendar", url: "https://palermo.blackboard.com/ultra/calendar" }
];

type EvaluatedTask = Omit<PendingTask, "id">;
const execFileAsync = promisify(execFile);

interface ChromeProfileInfo {
  executablePath: string;
  userDataDir: string;
  profileDirectory: string;
  profileDisplayName: string;
}

interface LoginCredentials {
  username: string;
  password: string;
  strategy: "auto" | "blackboard" | "myup";
}

interface LaunchResult {
  context: BrowserContext;
  warnings: string[];
}

interface ClonedProfileResult {
  userDataDir: string;
  warnings: string[];
}

interface ScrapedTaskDetailPayload {
  title?: string;
  course?: string;
  instructionsText: string;
  instructionsHtml?: string;
  rawText: string;
  attachments: TaskDetail["attachments"];
  metadata: TaskDetail["metadata"];
}

export async function syncPendingTasks(dataDir: string): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  const sources: ScrapeSourceResult[] = [];

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, "debug"), { recursive: true });

  const credentials = await resolveLoginCredentials(dataDir);

  const { context, warnings: launchWarnings } = await launchUserChrome(dataDir);
  warnings.push(...launchWarnings);

  const page = context.pages()[0] ?? (await context.newPage());
  let requiresManualLogin = false;

  try {
    requiresManualLogin = await ensureAuthenticated(page, credentials);

    const collectedTasks: PendingTask[] = [];
    for (const candidate of CANDIDATE_PAGES) {
      const source = await scrapeCandidatePage(page, dataDir, candidate.label, candidate.url);
      sources.push(source.source);
      collectedTasks.push(...source.tasks);
      warnings.push(...source.warnings);
    }

    const tasks = dedupeTasks(collectedTasks);
    const finishedAt = new Date().toISOString();

    return {
      startedAt,
      finishedAt,
      requiresManualLogin,
      tasks,
      warnings,
      sources
    };
  } finally {
    await context.close();
  }
}

export async function fetchTaskDetail(
  dataDir: string,
  input: { taskId: string; url: string }
): Promise<TaskDetail> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, "debug"), { recursive: true });

  const credentials = await resolveLoginCredentials(dataDir);
  const { context } = await launchUserChrome(dataDir);
  const page = context.pages()[0] ?? (await context.newPage());
  const slug = slugify(input.taskId);
  const htmlPath = path.join(dataDir, "debug", `task-detail-${slug}.html`);
  const screenshotPath = path.join(dataDir, "debug", `task-detail-${slug}.png`);

  try {
    await ensureAuthenticated(page, credentials);
    await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    await expandTaskInstructions(page);

    try {
      await fs.writeFile(htmlPath, await page.content(), "utf8");
    } catch {
      // Debug artifact only.
    }

    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch {
      // Debug artifact only.
    }

    const payload = (await page.evaluate(String.raw`
      (() => {
        function normalizeText(value) {
          return (value ?? "").replace(/\s+/g, " ").trim();
        }

        function absolutizeUrl(rawHref) {
          if (!rawHref) {
            return undefined;
          }

          try {
            return new URL(rawHref, document.location.href).toString();
          } catch {
            return rawHref;
          }
        }

        function headingText(node) {
          return normalizeText(node?.textContent).toLowerCase();
        }

        function findByHeading(possibleHeadings) {
          const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, strong, button, span, div"));
          for (let index = 0; index < headings.length; index += 1) {
            const node = headings[index];
            const text = headingText(node);
            if (!text) {
              continue;
            }

            for (let headingIndex = 0; headingIndex < possibleHeadings.length; headingIndex += 1) {
              if (text.includes(possibleHeadings[headingIndex])) {
                return node;
              }
            }
          }

          return null;
        }

        function extractMetadata() {
          const results = [];

          const sideEntries = document.querySelectorAll(".makeStylesdetails-0-2-322 .makeStylesroot-0-2-525");
          for (let index = 0; index < sideEntries.length; index += 1) {
            const entry = sideEntries[index];
            const label = normalizeText(entry.querySelector(".makeStylesheaderText-0-2-527")?.textContent);
            const value = normalizeText(entry.querySelector(".makeStylescontentRoot-0-2-526 div")?.textContent);
            if (label && value) {
              results.push({ label, value });
            }
          }

          const scoreSection = document.querySelector(".makeStylessubmissionContent-0-2-533");
          if (scoreSection) {
            const label = normalizeText(scoreSection.querySelector(".makeStylessubmissionText-0-2-534")?.textContent);
            const value = normalizeText(scoreSection.querySelector(".makeStylessubmissionValue-0-2-535")?.textContent);
            if (label && value) {
              results.push({ label, value });
            }
          }

          return results;
        }

        const title =
          normalizeText(document.querySelector(".js-readonly-header-text")?.textContent) ||
          normalizeText(document.querySelector("[data-qa='activity-title']")?.textContent) ||
          normalizeText(document.querySelector("assessment-overview-panel-header h1")?.textContent) ||
          undefined;
        const course =
          normalizeText(document.querySelector("[class*='subHeader'] div")?.textContent) ||
          normalizeText(document.querySelector(".makeStylessubHeader-0-2-293 div")?.textContent) ||
          undefined;

        const instructionsRoot =
          document.querySelector("#assignment-attempt-authoring-instructions") ||
          document.querySelector("[data-analytics-id='assignment.attempt.authoring.instructions.details']") ||
          findByHeading(["instrucciones de la actividad"])?.closest("section, article, div");
        const instructionsContainer =
          instructionsRoot instanceof Element ? instructionsRoot : null;
        const instructionsText = normalizeText(instructionsContainer?.textContent) || "";
        const instructionsHtml = instructionsContainer instanceof HTMLElement ? instructionsContainer.innerHTML : undefined;
        const attachments = [];

        if (instructionsContainer) {
          const attachmentNodes = instructionsContainer.querySelectorAll("[data-bbtype='attachment']");
          for (let index = 0; index < attachmentNodes.length; index += 1) {
            const node = attachmentNodes[index];
            const data = node.getAttribute("data-bbfile");
            let name =
              normalizeText(node.getAttribute("aria-label")) ||
              normalizeText(node.textContent);

            let url = absolutizeUrl(node.getAttribute("href"));
            let kind = undefined;

            if (data) {
              try {
                const parsed = JSON.parse(data);
                url = parsed.viewerUrl || parsed.resourceUrl || url;
                kind = parsed.mimeType || undefined;
                if (!name && parsed.displayName) {
                  name = normalizeText(parsed.displayName);
                }
              } catch {
                // Best effort only.
              }
            }

            if (!name) {
              continue;
            }

            attachments.push({
              name,
              url: absolutizeUrl(url),
              kind
            });
          }
        }

        return {
          title,
          course,
          instructionsText,
          instructionsHtml,
          rawText: normalizeText(document.body.textContent),
          attachments,
          metadata: extractMetadata()
        };
      })()
    `)) as ScrapedTaskDetailPayload;

    return {
      taskId: input.taskId,
      taskUrl: page.url(),
      title: payload.title,
      course: payload.course,
      instructionsText: payload.instructionsText,
      instructionsHtml: payload.instructionsHtml,
      rawText: payload.rawText,
      attachments: payload.attachments,
      metadata: payload.metadata,
      htmlPath,
      screenshotPath,
      scrapedAt: new Date().toISOString()
    };
  } finally {
    await context.close();
  }
}

async function launchUserChrome(dataDir: string): Promise<LaunchResult> {
  const profile = await resolveChromeProfile();
  const clonedProfile = await cloneChromeProfileForAutomation(dataDir, profile);

  try {
    const context = await chromium.launchPersistentContext(clonedProfile.userDataDir, {
      headless: false,
      executablePath: profile.executablePath,
      viewport: { width: 1440, height: 960 },
      args: [`--profile-directory=${profile.profileDirectory}`]
    });

    return {
      context,
      warnings: [
        ...clonedProfile.warnings,
        `Usando una copia automatizable del perfil de Chrome "${profile.profileDisplayName}".`,
        "Si cambias cookies o contrasenas en Chrome, cerra Chrome y vuelve a sincronizar para refrescar la copia."
      ]
    };
  } catch (error) {
    const details = formatError(error);
    throw new Error(
      `No se pudo abrir la copia automatizable de tu perfil de Chrome (${profile.profileDisplayName}). Cerra completamente Google Chrome e intenta de nuevo. Detalle: ${details}`
    );
  }
}

async function resolveChromeProfile(): Promise<ChromeProfileInfo> {
  const executablePath = resolveChromeExecutablePath();
  const userDataDir = resolveChromeUserDataDir();
  const localStatePath = path.join(userDataDir, "Local State");

  const requestedProfile = process.env.BLACKBOARD_CHROME_PROFILE?.trim();
  const localState = await readChromeLocalState(localStatePath);
  const profileDirectory = requestedProfile || readLastUsedProfile(localState) || "Default";
  const profileDisplayName = readProfileDisplayName(localState, profileDirectory);

  return {
    executablePath,
    userDataDir,
    profileDirectory,
    profileDisplayName
  };
}

function resolveChromeExecutablePath(): string {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe")
  ];

  for (const candidate of candidates) {
    if (candidate && fileExistsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("No encontre Google Chrome instalado en una ruta conocida.");
}

function resolveChromeUserDataDir(): string {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const userDataDir = path.join(localAppData, "Google", "Chrome", "User Data");

  if (!fileExistsSync(userDataDir)) {
    throw new Error("No encontre la carpeta de perfiles de Google Chrome.");
  }

  return userDataDir;
}

async function readChromeLocalState(localStatePath: string): Promise<Record<string, unknown> | null> {
  try {
    const contents = await fs.readFile(localStatePath, "utf8");
    return JSON.parse(contents) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readLastUsedProfile(localState: Record<string, unknown> | null): string | null {
  const profileState = asRecord(localState?.profile);
  const lastUsed = profileState?.last_used;
  return typeof lastUsed === "string" && lastUsed.trim() ? lastUsed : null;
}

function readProfileDisplayName(localState: Record<string, unknown> | null, profileDirectory: string): string {
  const profileState = asRecord(localState?.profile);
  const infoCache = asRecord(profileState?.info_cache);
  const selectedProfile = asRecord(infoCache?.[profileDirectory]);
  const displayName = selectedProfile?.name;

  return typeof displayName === "string" && displayName.trim() ? displayName : profileDirectory;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function fileExistsSync(targetPath: string): boolean {
  return existsSync(targetPath);
}

async function resolveLoginCredentials(dataDir: string): Promise<LoginCredentials | null> {
  const envUsername = process.env.BLACKBOARD_USERNAME?.trim();
  const envPassword = process.env.BLACKBOARD_PASSWORD?.trim();
  const envStrategy = normalizeStrategy(process.env.BLACKBOARD_LOGIN_STRATEGY);

  if (envUsername && envPassword) {
    return {
      username: envUsername,
      password: envPassword,
      strategy: envStrategy
    };
  }

  const credentialsPath = path.join(dataDir, "credentials.json");
  if (!fileExistsSync(credentialsPath)) {
    return null;
  }

  try {
    const raw = await fs.readFile(credentialsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LoginCredentials>;
    const username = parsed.username?.trim();
    const password = parsed.password?.trim();

    if (!username || !password) {
      return null;
    }

    return {
      username,
      password,
      strategy: normalizeStrategy(parsed.strategy)
    };
  } catch {
    return null;
  }
}

function normalizeStrategy(value: unknown): LoginCredentials["strategy"] {
  return value === "blackboard" || value === "myup" ? value : "auto";
}

async function cloneChromeProfileForAutomation(
  dataDir: string,
  profile: ChromeProfileInfo
): Promise<ClonedProfileResult> {
  const automationRunsDir = path.join(dataDir, "chrome-automation-runs");
  const runId = `run-${Date.now()}`;
  const automationUserDataDir = path.join(automationRunsDir, runId);
  const targetProfileDir = path.join(automationUserDataDir, profile.profileDirectory);
  const sourceProfileDir = path.join(profile.userDataDir, profile.profileDirectory);
  const sourceLocalState = path.join(profile.userDataDir, "Local State");
  const targetLocalState = path.join(automationUserDataDir, "Local State");
  const warnings: string[] = [];

  if (!fileExistsSync(sourceProfileDir)) {
    throw new Error(`No encontre el perfil de Chrome seleccionado: ${profile.profileDirectory}`);
  }

  const chromeProcesses = await listRunningChromeProcesses();
  if (chromeProcesses.length > 0) {
    const details = chromeProcesses.slice(0, 5).join(", ");
    throw new Error(
      `Chrome sigue abierto o en segundo plano (${chromeProcesses.length} procesos detectados: ${details}). Cierra Chrome desde menu > Salir e intenta de nuevo.`
    );
  }

  await fs.mkdir(automationRunsDir, { recursive: true });
  await cleanupOldAutomationRuns(automationRunsDir);
  await fs.mkdir(automationUserDataDir, { recursive: true });

  try {
    if (fileExistsSync(sourceLocalState)) {
      await fs.copyFile(sourceLocalState, targetLocalState);
    }

    await fs.cp(sourceProfileDir, targetProfileDir, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
  } catch (error) {
    await fs.rm(automationUserDataDir, { recursive: true, force: true }).catch(() => {});

    throw new Error(
      `No se pudo copiar el perfil de Chrome para automatizacion. Cerra Chrome para liberar archivos bloqueados. Detalle: ${formatError(error)}`
    );
  }

  return {
    userDataDir: automationUserDataDir,
    warnings
  };
}

async function cleanupOldAutomationRuns(automationRunsDir: string): Promise<void> {
  try {
    const entries = await fs.readdir(automationRunsDir, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const directoriesToDelete = directories.slice(0, Math.max(0, directories.length - 2));

    await Promise.all(
      directoriesToDelete.map((directoryName) =>
        fs.rm(path.join(automationRunsDir, directoryName), { recursive: true, force: true }).catch(() => {})
      )
    );
  } catch {
    // Best effort cleanup only.
  }
}

async function listRunningChromeProcesses(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV", "/NH", "/FI", "IMAGENAME eq chrome.exe"], {
      windowsHide: true
    });

    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("INFO:"))
      .map((line) => line.replace(/^"|"$/g, ""))
      .map((line) => line.split('","'))
      .filter((parts) => parts[0]?.toLowerCase() === "chrome.exe")
      .map((parts) => `${parts[0]} pid ${parts[1]}`);
  } catch {
    return [];
  }
}

async function ensureAuthenticated(page: Page, credentials: LoginCredentials | null): Promise<boolean> {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await dismissCookieDialog(page);
  await attemptAutoLogin(page, credentials);

  if (await isAuthenticated(page)) {
    return false;
  }

  await page.goto(ULTRA_HOME_URL, { waitUntil: "domcontentloaded" });
  await dismissCookieDialog(page);
  await attemptAutoLogin(page, credentials);

  if (await isAuthenticated(page)) {
    return false;
  }

  await waitForManualLogin(page);
  return true;
}

async function waitForManualLogin(page: Page): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < LOGIN_WAIT_TIMEOUT_MS) {
    if (await isAuthenticated(page)) {
      return;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(
    "No se detecto un login exitoso en Blackboard dentro del tiempo esperado. Abri la ventana del navegador y completa el acceso."
  );
}

async function attemptAutoLogin(page: Page, credentials: LoginCredentials | null): Promise<void> {
  await page.waitForTimeout(1500);

  if (await isAuthenticated(page)) {
    return;
  }

  if (credentials) {
    const loggedByCredentials = await tryCredentialsLogin(page, credentials);
    if (loggedByCredentials) {
      await page.waitForTimeout(4000);
      await dismissCookieDialog(page);
      if (await isAuthenticated(page)) {
        return;
      }
    }
  }

  const usedSso = await attemptMyUpSso(page);
  if (usedSso) {
    await page.waitForTimeout(4000);
    await dismissCookieDialog(page);

    if (credentials) {
      const loggedBySsoCredentials = await tryGenericCredentialsSubmit(page, credentials);
      if (loggedBySsoCredentials) {
        await page.waitForTimeout(4000);
        await dismissCookieDialog(page);
      }
    }

    if (await isAuthenticated(page)) {
      return;
    }
  }

  await trySubmitAutofilledLogin(page);
}

async function attemptMyUpSso(page: Page): Promise<boolean> {
  const myUpLink = page.getByRole("link", { name: /myup/i });
  if ((await myUpLink.count()) === 0) {
    return false;
  }

  try {
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {}),
      myUpLink.first().click({ timeout: 5000 })
    ]);
    return true;
  } catch {
    return false;
  }
}

async function trySubmitAutofilledLogin(page: Page): Promise<void> {
  const credentialsReady = await page
    .evaluate(() => {
      const userInput = document.querySelector<HTMLInputElement>("#user_id");
      const passwordInput = document.querySelector<HTMLInputElement>("#password");

      return Boolean(userInput?.value && passwordInput?.value);
    })
    .catch(() => false);

  if (!credentialsReady) {
    return;
  }

  const loginButton = page.locator("#entry-login");
  if ((await loginButton.count()) === 0) {
    return;
  }

  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {}),
    loginButton.first().click({ timeout: 5000 })
  ]).catch(() => {});
}

async function tryCredentialsLogin(page: Page, credentials: LoginCredentials): Promise<boolean> {
  if (credentials.strategy === "myup") {
    const usedSso = await attemptMyUpSso(page);
    if (!usedSso) {
      return false;
    }

    await page.waitForTimeout(2000);
    return tryGenericCredentialsSubmit(page, credentials);
  }

  const directLoginWorked = await tryBlackboardCredentialsSubmit(page, credentials);
  if (directLoginWorked) {
    return true;
  }

  if (credentials.strategy === "blackboard") {
    return false;
  }

  const usedSso = await attemptMyUpSso(page);
  if (!usedSso) {
    return false;
  }

  await page.waitForTimeout(2000);
  return tryGenericCredentialsSubmit(page, credentials);
}

async function tryBlackboardCredentialsSubmit(page: Page, credentials: LoginCredentials): Promise<boolean> {
  const userInput = page.locator("#user_id");
  const passwordInput = page.locator("#password");
  const loginButton = page.locator("#entry-login");

  if ((await userInput.count()) === 0 || (await passwordInput.count()) === 0 || (await loginButton.count()) === 0) {
    return false;
  }

  await userInput.first().fill(credentials.username);
  await passwordInput.first().fill(credentials.password);
  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {}),
    loginButton.first().click({ timeout: 5000 })
  ]).catch(() => {});

  return true;
}

async function tryGenericCredentialsSubmit(page: Page, credentials: LoginCredentials): Promise<boolean> {
  const passwordInput = page
    .locator(
      "input[type='password']:not([disabled]), input[name*='pass' i]:not([disabled]), input[id*='pass' i]:not([disabled])"
    )
    .first();

  if ((await passwordInput.count()) === 0) {
    return false;
  }

  const usernameInput = page
    .locator(
      [
        "input[autocomplete='username']:not([disabled])",
        "input[type='email']:not([disabled])",
        "input[name*='user' i]:not([disabled])",
        "input[id*='user' i]:not([disabled])",
        "input[name*='mail' i]:not([disabled])",
        "input[id*='mail' i]:not([disabled])",
        "input[type='text']:not([disabled])"
      ].join(", ")
    )
    .first();

  if ((await usernameInput.count()) > 0) {
    await usernameInput.fill(credentials.username).catch(() => {});
  }

  await passwordInput.fill(credentials.password).catch(() => {});

  const submitButton = page
    .locator("button, input[type='submit'], input[type='button']")
    .filter({ hasText: /ingresar|iniciar|acceder|continuar|login|sign in/i })
    .first();

  if ((await submitButton.count()) > 0) {
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {}),
      submitButton.click({ timeout: 5000 })
    ]).catch(() => {});
    return true;
  }

  await passwordInput.press("Enter").catch(() => {});
  return true;
}

async function isAuthenticated(page: Page): Promise<boolean> {
  const currentUrl = page.url();
  if (currentUrl.includes("/ultra")) {
    return true;
  }

  const loginTextbox = page.getByRole("textbox", { name: /usuario/i });
  if ((await loginTextbox.count()) > 0) {
    return false;
  }

  const myUpLink = page.getByRole("link", { name: /myup/i });
  if ((await myUpLink.count()) > 0) {
    return false;
  }

  return false;
}

async function dismissCookieDialog(page: Page): Promise<void> {
  const acceptButton = page.getByRole("button", { name: /^aceptar$/i });
  if ((await acceptButton.count()) === 0) {
    return;
  }

  try {
    await acceptButton.first().click({ timeout: 2000 });
    await page.waitForTimeout(300);
  } catch {
    // The dialog is optional and sometimes closes by itself.
  }
}

async function expandTaskInstructions(page: Page): Promise<void> {
  const selectors = [
    page.getByRole("button", { name: /ver instrucciones/i }),
    page.getByRole("link", { name: /ver instrucciones/i }),
    page.getByRole("button", { name: /instrucciones de la actividad/i }),
    page.getByRole("link", { name: /instrucciones de la actividad/i }),
    page
      .locator("a, button, [role='button']")
      .filter({ hasText: /ver instrucciones|instrucciones de la actividad/i })
  ];

  for (const locator of selectors) {
    if ((await locator.count()) === 0) {
      continue;
    }

    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {}),
      locator.first().click({ timeout: 3000 }).catch(() => {})
    ]);
    await page.waitForTimeout(1800);
    return;
  }
}

async function scrapeCandidatePage(
  page: Page,
  dataDir: string,
  label: string,
  url: string
): Promise<{ source: ScrapeSourceResult; tasks: PendingTask[]; warnings: string[] }> {
  const warnings: string[] = [];
  const isCalendarPage = label === "Calendar";

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);

    if (isCalendarPage) {
      const deadlineViewButton = page.locator("#bb-calendar1-deadline");
      if ((await deadlineViewButton.count()) > 0) {
        await deadlineViewButton.first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(3000);
      } else {
        warnings.push("Calendar: no se encontro el boton de Fechas de vencimiento.");
      }
    }
  } catch (error) {
    return {
      source: {
        label,
        url,
        taskCount: 0,
        warning: formatError(error)
      },
      tasks: [],
      warnings: [`${label}: ${formatError(error)}`]
    };
  }

  const slug = slugify(label);
  const htmlPath = path.join(dataDir, "debug", `${slug}.html`);
  const screenshotPath = path.join(dataDir, "debug", `${slug}.png`);

  try {
    await fs.writeFile(htmlPath, await page.content(), "utf8");
  } catch (error) {
    warnings.push(`${label}: no se pudo guardar el HTML de depuracion (${formatError(error)})`);
  }

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch (error) {
    warnings.push(`${label}: no se pudo guardar la captura (${formatError(error)})`);
  }

  const evaluatedTasks = (await page.evaluate(String.raw`
    (() => {
      function normalizeText(value) {
        return (value ?? "").replace(/\s+/g, " ").trim();
      }

      function inferStatus(text) {
        if (/overdue|atrasad|vencid/i.test(text)) {
          return "overdue";
        }
        if (/pending|pendient/i.test(text)) {
          return "pending";
        }
        if (/upcoming|proxim|due|vence|entrega/i.test(text)) {
          return "upcoming";
        }
        return "unknown";
      }

      function absolutizeUrl(rawHref) {
        if (!rawHref) {
          return undefined;
        }

        try {
          return new URL(rawHref, document.location.href).toString();
        } catch {
          return rawHref;
        }
      }

      function pickFirst(root, candidates) {
        for (let index = 0; index < candidates.length; index += 1) {
          const selector = candidates[index];
          if (!selector) {
            continue;
          }

          const element = root.querySelector(selector);
          const text = normalizeText(element?.textContent);
          if (text) {
            return text;
          }
        }

        return undefined;
      }

      if (document.location.href.includes("/ultra/calendar")) {
        const deadlineCards = document.querySelectorAll(".element-card.due-item.element-card-deadline");
        const deadlineTasks = [];

        for (let index = 0; index < deadlineCards.length; index += 1) {
          const card = deadlineCards[index];
          if (!(card instanceof Element)) {
            continue;
          }

          const title = normalizeText(card.querySelector(".name a")?.textContent);
          const dueText = normalizeText(card.querySelector(".content > span")?.textContent);
          const courseLink = card.querySelector(".content a[href]");
          const course = normalizeText(courseLink?.textContent);
          const rawText = normalizeText(card.textContent);

          if (!title || !dueText || !course || !rawText) {
            continue;
          }

          deadlineTasks.push({
            title,
            course,
            dueText,
            description: rawText,
            url: absolutizeUrl(courseLink?.getAttribute("href") ?? null),
            status: inferStatus(dueText),
            sourcePage: document.location.href,
            rawText
          });
        }

        if (deadlineTasks.length > 0) {
          return deadlineTasks;
        }
      }

      const keywordPattern = /(pendient|pending|upcoming|overdue|due|vence|vencim|entrega|proxim|atrasad)/i;
      const selectors = [
        "article",
        "[role='listitem']",
        "li",
        "[class*='item']",
        "[class*='card']",
        "[class*='activity']",
        "[class*='stream']",
        "[class*='calendar']"
      ];
      const uniqueNodes = new Set();
      const tasks = [];

      for (let selectorIndex = 0; selectorIndex < selectors.length; selectorIndex += 1) {
        const selector = selectors[selectorIndex];
        if (!selector) {
          continue;
        }

        const matches = document.querySelectorAll(selector);
        for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
          const match = matches[matchIndex];
          if (match instanceof Element) {
            uniqueNodes.add(match);
          }
        }
      }

      for (const node of uniqueNodes) {
        const rawText = normalizeText(node.textContent);
        if (!rawText || rawText.length < 20 || rawText.length > 800) {
          continue;
        }
        if (!keywordPattern.test(rawText)) {
          continue;
        }

        const title =
          pickFirst(node, ["h1", "h2", "h3", "h4", "[role='heading']", "strong", "a"]) ||
          rawText.split(/(?<=[.!?])\s|\s{2,}|\n/)[0] ||
          "Tarea sin titulo";
        const course = pickFirst(node, ["[class*='course']", "[data-course-id]", "small", "span"]);
        const dueTextMatch = rawText.match(
          /(vence[^.]+|vencim[^.]+|entrega[^.]+|due[^.]+|upcoming[^.]+|proxim[^.]+|atrasad[^.]+)/i
        );
        const dueText = dueTextMatch?.[0]?.trim();
        const anchor = node.querySelector("a[href]");
        const description = rawText === title ? undefined : rawText;

        tasks.push({
          title,
          course,
          dueText,
          description,
          url: anchor?.getAttribute("href") ?? undefined,
          status: inferStatus(rawText),
          sourcePage: document.location.href,
          rawText
        });
      }

      return tasks;
    })()
  `)) as EvaluatedTask[];

  return {
    source: {
      label,
      url: page.url(),
      taskCount: evaluatedTasks.length,
      htmlPath,
      screenshotPath
    },
    tasks: evaluatedTasks.map((task) => ({
      ...task,
      id: buildTaskId(task)
    })),
    warnings
  };
}

function dedupeTasks(tasks: PendingTask[]): PendingTask[] {
  const map = new Map<string, PendingTask>();

  for (const task of tasks) {
    const key = task.id;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, task);
      continue;
    }

    if ((task.description?.length ?? 0) > (existing.description?.length ?? 0)) {
      map.set(key, task);
    }
  }

  return [...map.values()].sort((left, right) => {
    const courseCompare = (left.course ?? "").localeCompare(right.course ?? "");
    if (courseCompare !== 0) {
      return courseCompare;
    }

    return left.title.localeCompare(right.title);
  });
}

function buildTaskId(task: Pick<PendingTask, "title" | "course" | "dueText" | "sourcePage">): string {
  return slugify(`${task.course ?? "general"}-${task.title}-${task.dueText ?? "sin-fecha"}-${task.sourcePage}`);
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function parseTimeoutMs(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}
