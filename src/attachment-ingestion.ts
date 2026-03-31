import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import type { Page } from "playwright";
import type { TaskAttachment, TaskDetail } from "./types";

export async function enrichTaskDetailAttachments(
  detail: TaskDetail,
  page: Page,
  dataDir: string
): Promise<TaskDetail> {
  if (!detail.attachments.length) {
    return detail;
  }

  const attachmentDir = path.join(dataDir, "attachments", slugify(detail.taskId));
  await fs.mkdir(attachmentDir, { recursive: true });

  const attachments = await Promise.all(
    detail.attachments.map((attachment, index) =>
      ingestAttachment(attachment, {
        page,
        attachmentDir,
        refererUrl: detail.taskUrl,
        fallbackName: `${index + 1}-${attachment.name || "adjunto"}`
      })
    )
  );

  return {
    ...detail,
    attachments
  };
}

async function ingestAttachment(
  attachment: TaskAttachment,
  input: {
    page: Page;
    attachmentDir: string;
    refererUrl: string;
    fallbackName: string;
  }
): Promise<TaskAttachment> {
  const candidateUrls = [attachment.url, ...(attachment.alternateUrls ?? [])].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  if (candidateUrls.length === 0) {
    return {
      ...attachment,
      ingestionStatus: attachment.ingestionStatus ?? "detected"
    };
  }

  let lastError = "No se encontro una URL descargable para el adjunto.";

  try {
    for (const candidateUrl of candidateUrls) {
      const download = await downloadAttachmentThroughBrowser(input.page, candidateUrl, input.refererUrl);
      if (!download.ok) {
        lastError = `Blackboard devolvio ${download.status} al descargar el adjunto.`;
        continue;
      }

      const buffer = download.body;
      const contentType = download.headers.contentType?.split(";")[0]?.trim() || attachment.kind;
      if (looksLikeHtmlPdfWrapper(buffer, contentType)) {
        lastError = "Blackboard devolvio el visor HTML del PDF, no el binario real.";
        continue;
      }

      const targetName = resolveAttachmentFileName(
        attachment,
        download.headers.contentDisposition || null,
        contentType,
        input.fallbackName
      );
      const localPath = path.join(input.attachmentDir, targetName);
      await fs.writeFile(localPath, buffer);

      const downloadedAttachment: TaskAttachment = {
        ...attachment,
        url: candidateUrl,
        contentType,
        localPath,
        byteSize: buffer.byteLength,
        ingestionStatus: "downloaded"
      };

      return extractDownloadedAttachment(downloadedAttachment, localPath, buffer);
    }

    throw new Error(lastError);
  } catch (error) {
    return {
      ...attachment,
      ingestionStatus: "failed",
      extractionError: error instanceof Error ? error.message : String(error)
    };
  }
}

async function downloadAttachmentThroughBrowser(
  page: Page,
  url: string,
  refererUrl: string
): Promise<{
  ok: boolean;
  status: number;
  headers: { contentType: string | null; contentDisposition: string | null };
  body: Buffer;
}> {
  const requestResponse = await page.context().request
    .get(url, {
      headers: {
        Referer: refererUrl
      },
      failOnStatusCode: false
    })
    .catch(() => null);

  if (requestResponse?.ok()) {
    return {
      ok: true,
      status: requestResponse.status(),
      headers: {
        contentType: requestResponse.headers()["content-type"] || null,
        contentDisposition: requestResponse.headers()["content-disposition"] || null
      },
      body: Buffer.from(await requestResponse.body())
    };
  }

  const tempPage = await page.context().newPage();

  try {
    const response = await tempPage.goto(url, {
      waitUntil: "commit",
      timeout: 30000
    });

    if (!response) {
      return {
        ok: false,
        status: 0,
        headers: { contentType: null, contentDisposition: null },
        body: Buffer.alloc(0)
      };
    }

    return {
      ok: response.ok(),
      status: response.status(),
      headers: {
        contentType: response.headers()["content-type"] || null,
        contentDisposition: response.headers()["content-disposition"] || null
      },
      body: Buffer.from(await response.body())
    };
  } finally {
    await tempPage.close().catch(() => {});
  }
}

async function extractDownloadedAttachment(
  attachment: TaskAttachment,
  localPath: string,
  buffer: Buffer
): Promise<TaskAttachment> {
  const extension = path.extname(localPath).toLowerCase();
  const contentType = attachment.contentType?.toLowerCase() || "";

  if (extension === ".pdf" || contentType === "application/pdf") {
    const result = await extractPdfText(localPath);
    return {
      ...attachment,
      extractedText: result.text || undefined,
      extractedAt: new Date().toISOString(),
      extractionError: result.warnings.length > 0 ? result.warnings.join(" | ") : undefined,
      ingestionStatus: result.needsOcr ? "requires_ocr" : "indexed"
    };
  }

  if ([".txt", ".md", ".csv", ".json", ".html", ".htm"].includes(extension) || contentType.startsWith("text/")) {
    const text = buffer.toString("utf8").trim();
    return {
      ...attachment,
      extractedText: text || undefined,
      extractedAt: new Date().toISOString(),
      ingestionStatus: text ? "indexed" : "unsupported"
    };
  }

  return {
    ...attachment,
    ingestionStatus: "unsupported",
    extractionError: "Tipo de adjunto sin extractor automatico todavia."
  };
}

async function extractPdfText(localPath: string): Promise<{ text: string; needsOcr: boolean; warnings: string[] }> {
  const scriptPath = path.join(process.cwd(), "scripts", "extract_pdf_text.py");

  const stdout = await runProcess("python", [scriptPath, localPath]);
  const parsed = JSON.parse(stdout) as {
    ok: boolean;
    text?: string;
    needsOcr?: boolean;
    warnings?: string[];
    error?: string;
  };

  if (!parsed.ok) {
    throw new Error(parsed.error || "Fallo la extraccion de texto del PDF.");
  }

  return {
    text: parsed.text?.trim() || "",
    needsOcr: Boolean(parsed.needsOcr),
    warnings: parsed.warnings ?? []
  };
}

function resolveAttachmentFileName(
  attachment: TaskAttachment,
  contentDisposition: string | null,
  contentType: string | undefined,
  fallbackName: string
): string {
  const fromDisposition = contentDisposition?.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i)?.[1];
  const baseName = decodeURIComponentSafe(fromDisposition || attachment.name || fallbackName).trim();
  const extension = path.extname(baseName) || inferExtension(contentType) || inferExtensionFromUrl(attachment.url);
  const withoutExtension = extension ? baseName.replace(new RegExp(`${escapeRegExp(extension)}$`, "i"), "") : baseName;
  return `${sanitizeFileName(withoutExtension || fallbackName)}${extension || ""}`;
}

function inferExtension(contentType: string | undefined): string {
  switch ((contentType || "").toLowerCase()) {
    case "application/pdf":
      return ".pdf";
    case "text/plain":
      return ".txt";
    case "text/markdown":
      return ".md";
    case "text/html":
      return ".html";
    case "application/json":
      return ".json";
    default:
      return "";
  }
}

function inferExtensionFromUrl(url: string | undefined): string {
  if (!url) {
    return "";
  }

  try {
    const pathname = new URL(url).pathname;
    return path.extname(pathname);
  } catch {
    return "";
  }
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "adjunto";
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function looksLikeHtmlPdfWrapper(buffer: Buffer, contentType: string | undefined): boolean {
  const start = buffer.slice(0, 256).toString("utf8").toLowerCase();
  return (
    (contentType || "").toLowerCase() === "application/pdf" &&
    (start.includes("<!doctype html") || start.includes("<html") || start.includes("pdf_embedder.css"))
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} termino con codigo ${code}.`));
        return;
      }

      resolve(stdout.trim());
    });
  });
}
