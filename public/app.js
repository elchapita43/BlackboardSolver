// UI Elements
const syncButton = document.querySelector("#syncButton");
const statusPill = document.querySelector("#statusPill");
const meta = document.querySelector("#meta");
const hydrationMeta = document.querySelector("#hydrationMeta");
const tasksContainer = document.querySelector("#tasks");
const warningsContainer = document.querySelector("#warnings");
const sourcesContainer = document.querySelector("#sources");
const sourcesPanel = document.querySelector("#sourcesPanel");
const sourcesHeader = document.querySelector("#sourcesHeader");
const sourcesContent = document.querySelector("#sourcesContent");
const taskUrlInput = document.querySelector("#taskUrlInput");
const fetchDetailButton = document.querySelector("#fetchDetailButton");
const taskDetail = document.querySelector("#taskDetail");
const chatLog = document.querySelector("#chatLog");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const chatSendButton = document.querySelector("#chatSendButton");
const chatMeta = document.querySelector("#chatMeta");
const chatScrollArea = document.querySelector("#chatScrollArea");
const toastContainer = document.querySelector("#toastContainer");

const state = {
  snapshot: null,
  tasks: [],
  selectedTaskId: "",
  selectedDetail: null,
  hydrationStatus: null,
  chatThreadId: "",
  chatMessages: []
};

// Utils
const setStatus = (label, stateName) => {
  statusPill.textContent = label;
  statusPill.className = `status-pill ${stateName}`;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

// Toast Notification System
const showToast = (message, type = "info", duration = 5000) => {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button class="toast-close" type="button">&times;</button>
  `;

  const closeBtn = toast.querySelector(".toast-close");
  
  const removeToast = () => {
    toast.style.animation = "fadeOut 0.3s forwards";
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 300);
  };

  closeBtn.addEventListener("click", removeToast);
  
  toastContainer.appendChild(toast);

  if (duration > 0) {
    setTimeout(removeToast, duration);
  }
};

// Render Functions
const renderWarnings = (warnings) => {
  if (!warnings?.length) {
    warningsContainer.classList.add("hidden");
    warningsContainer.innerHTML = "";
    return;
  }

  warningsContainer.classList.remove("hidden");
  warningsContainer.innerHTML = warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("");
};

const renderSources = (sources) => {
  if (!sources?.length) {
    sourcesContainer.className = "source-list empty";
    sourcesContainer.textContent = "No hay fuentes inspeccionadas todavía.";
    return;
  }

  sourcesContainer.className = "source-list";
  sourcesContainer.innerHTML = sources
    .map(
      (source) => `
        <article class="source-card">
          <h3>${escapeHtml(source.label)}</h3>
          <p>${escapeHtml(source.url)}</p>
          <p>${escapeHtml(String(source.taskCount))} tareas detectadas</p>
          ${source.warning ? `<p class="source-warning">${escapeHtml(source.warning)}</p>` : ""}
        </article>
      `
    )
    .join("");
};

const renderTasks = (tasks) => {
  meta.textContent = String(tasks?.length || 0);

  if (!tasks?.length) {
    tasksContainer.className = "task-list empty";
    tasksContainer.innerHTML = "No se detectaron tareas pendientes.";
    return;
  }

  tasksContainer.className = "task-list";
  tasksContainer.innerHTML = tasks
    .map((task) => {
      const selected = task.id === state.selectedTaskId;
      return `
        <article class="task-card ${selected ? "selected" : ""}" data-task-id="${escapeHtml(task.id)}">
          <div class="task-topline">
            <span class="badge ${escapeHtml(task.status)}">${escapeHtml(task.status)}</span>
            <span class="source">${escapeHtml(task.sourcePage)}</span>
          </div>
          <h3>${escapeHtml(task.title)}</h3>
          <p class="meta-line">
            ${task.course ? `<span>${escapeHtml(task.course)}</span>` : ""}
            ${task.dueText ? `<span> &bull; ${escapeHtml(task.dueText)}</span>` : ""}
          </p>
        </article>
      `;
    })
    .join("");
};

const renderHydrationStatus = (status) => {
  state.hydrationStatus = status ?? null;

  if (!hydrationMeta) return;

  if (!status) {
    hydrationMeta.textContent = "";
    return;
  }

  if (status.isRunning) {
    hydrationMeta.textContent = `Enriqueciendo detalles en segundo plano: ${status.completed}/${status.total}`;
    return;
  }

  if (status.total > 0 && status.finishedAt) {
    hydrationMeta.textContent =
      status.failed > 0
        ? `Detalle automatico finalizado con ${status.failed} fallo(s).`
        : "Detalle automatico finalizado.";
    return;
  }

  hydrationMeta.textContent = "";
};

const renderSnapshot = (snapshot) => {
  if (!snapshot) {
    renderWarnings([]);
    renderTasks([]);
    renderSources([]);
    setStatus("Sin sincronizar", "idle");
    return;
  }

  renderWarnings(snapshot.warnings ?? []);
  renderSources(snapshot.sources ?? []);
  setStatus(snapshot.requiresManualLogin ? "Login manual detectado" : "Sincronizado", "success");
};

const renderTaskDetail = (detail) => {
  state.selectedDetail = detail;

  if (!detail) {
    taskDetail.className = "detail-card empty";
    taskDetail.innerHTML = "Selecciona una tarea en la lista para ver su detalle.";
    return;
  }

  const instructionsText = detail.instructionsText?.trim();
  const fallbackInstructions = detail.attachments?.length
    ? "Blackboard no muestra texto visible para esta actividad, pero si detecte adjuntos abajo. La consigna probablemente este ahi."
    : "Blackboard no mostro instrucciones visibles para esta actividad.";

  taskDetail.className = "detail-card";
  taskDetail.innerHTML = `
    <h3>${escapeHtml(detail.title || "Detalle de tarea")}</h3>
    ${detail.course ? `<p class="meta-line"><span>${escapeHtml(detail.course)}</span></p>` : ""}
    ${detail.metadata?.length ? `<div class="detail-metadata">${detail.metadata.map((item) => `<p><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</p>`).join("")}</div>` : ""}
    <div class="detail-block">
      <h4>Instrucciones</h4>
      <p>${escapeHtml(instructionsText || fallbackInstructions)}</p>
    </div>
    <div class="detail-block">
      <h4>Adjuntos detectados</h4>
      ${
        detail.attachments?.length
          ? detail.attachments
              .map((attachment) =>
                attachment.url
                  ? `<p><a href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer" class="attachment-link">${escapeHtml(attachment.name)}</a></p>`
                  : `<p>${escapeHtml(attachment.name)}</p>`
              )
              .join("")
          : "<p class='hint'>No se detectaron adjuntos estructurados.</p>"
      }
    </div>
  `;
};

const renderChat = () => {
  if (!state.chatMessages.length) {
    chatLog.className = "chat-log empty";
    chatLog.textContent = "Escribe un mensaje abajo para comenzar la conversación.";
  } else {
    chatLog.className = "chat-log";
    chatLog.innerHTML = state.chatMessages
      .map(
        (message) => {
          let htmlContent = escapeHtml(message.content);
          
          if (message.role === "assistant" && typeof window.marked !== "undefined" && typeof window.DOMPurify !== "undefined") {
            const rawMarkup = window.marked.parse(message.content);
            htmlContent = window.DOMPurify.sanitize(rawMarkup);
          }

          return `
            <article class="chat-bubble ${escapeHtml(message.role)}">
              ${message.role === "user" ? `<p>${htmlContent}</p>` : htmlContent}
            </article>
          `;
        }
      )
      .join("");
  }

  chatMeta.textContent = state.chatThreadId ? "Chat activo" : "Sin conversación";
  
  // Auto-scroll al final
  if (chatScrollArea) {
    setTimeout(() => {
      chatScrollArea.scrollTop = chatScrollArea.scrollHeight;
    }, 10);
  }
};

// Data Fetching
const loadLatest = async () => {
  const response = await fetch("/api/tasks");
  const payload = await response.json();
  state.snapshot = payload.snapshot ?? null;
  renderSnapshot(state.snapshot);
};

const loadLibrary = async () => {
  const response = await fetch("/api/library/tasks");
  const payload = await response.json();
  state.tasks = payload.tasks ?? [];
  renderTasks(state.tasks);
};

const loadHydrationStatus = async () => {
  const response = await fetch("/api/tasks/hydration-status");
  const payload = await response.json();
  renderHydrationStatus(payload.status ?? null);
};

const loadSelectedTask = async () => {
  if (!state.selectedTaskId) {
    taskUrlInput.value = "";
    renderTaskDetail(null);
    return;
  }

  try {
    const response = await fetch(`/api/library/tasks/${encodeURIComponent(state.selectedTaskId)}`);
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "No se pudo cargar el detalle de la tarea.");
    }

    const task = payload.task;
    taskUrlInput.value = task?.url || "";
    if (!payload.detail && state.hydrationStatus?.isRunning) {
      renderTaskDetail({
        title: task?.title,
        course: task?.course,
        metadata: [],
        attachments: [],
        instructionsText: "Extrayendo detalle automaticamente en segundo plano...",
        taskId: task?.id,
        taskUrl: task?.url || "",
        rawText: task?.rawText || "",
        scrapedAt: new Date().toISOString()
      });
      return;
    }

    renderTaskDetail(payload.detail ?? null);
  } catch (error) {
    showToast(error.message, "error");
    renderTaskDetail(null);
  }
};

const selectTask = async (taskId) => {
  if (state.selectedTaskId === taskId) return;
  
  state.selectedTaskId = taskId || "";
  renderTasks(state.tasks);
  
  if (taskId) {
    taskDetail.innerHTML = '<div class="empty">Cargando contexto...</div>';
    await loadSelectedTask();
  } else {
    renderTaskDetail(null);
  }
};

// Event Listeners
syncButton.addEventListener("click", async () => {
  syncButton.disabled = true;
  setStatus("Sincronizando...", "loading");

  try {
    const response = await fetch("/api/tasks/sync", { method: "POST" });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Falló la sincronización.");
    }

    state.snapshot = payload.snapshot;
    renderSnapshot(state.snapshot);
    await loadLibrary();
    await loadHydrationStatus();
    showToast("Sincronización completada exitosamente.", "success");
  } catch (error) {
    setStatus("Error", "error");
    const msg = error instanceof Error ? error.message : String(error);
    renderWarnings([msg]);
    showToast(`Error al sincronizar: ${msg}`, "error");
  } finally {
    syncButton.disabled = false;
  }
});

tasksContainer.addEventListener("click", async (event) => {
  const card = event.target.closest(".task-card");
  if (!card) return;

  const taskId = card.dataset.taskId;
  await selectTask(taskId);
});

fetchDetailButton.addEventListener("click", async () => {
  const url = taskUrlInput.value.trim();
  if (!url && !state.selectedTaskId) {
    showToast("Selecciona una tarea o pega una URL de Blackboard valida.", "warning");
    return;
  }

  fetchDetailButton.disabled = true;
  const originalText = fetchDetailButton.textContent;
  fetchDetailButton.textContent = "Extrayendo...";

  try {
    const response = await fetch("/api/library/fetch-detail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: state.selectedTaskId || undefined,
        url: url || undefined
      })
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "No se pudo extraer el detalle.");
    }

    if (!state.selectedTaskId && payload.detail?.taskId) {
      state.selectedTaskId = payload.detail.taskId;
    }

    await loadLibrary();
    await loadHydrationStatus();
    await loadSelectedTask();
    showToast("Detalle releido y guardado correctamente.", "success");
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    fetchDetailButton.disabled = false;
    fetchDetailButton.textContent = originalText;
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = chatInput.value.trim();
  if (!message) return;

  chatSendButton.disabled = true;
  chatInput.disabled = true;
  
  state.chatMessages.push({ role: "user", content: message });
  renderChat();
  chatInput.value = "";

  // Añadir placeholder temporal de carga
  state.chatMessages.push({ role: "assistant", content: "..." });
  renderChat();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: state.chatThreadId || undefined,
        taskId: state.selectedTaskId || undefined,
        message
      })
    });
    const payload = await response.json();

    state.chatMessages.pop(); // quitar placeholder

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "No se pudo procesar la respuesta.");
    }

    state.chatThreadId = payload.threadId;
    state.chatMessages.push({ role: "assistant", content: payload.reply });
    renderChat();
  } catch (error) {
    state.chatMessages.pop(); // quitar placeholder
    state.chatMessages.push({
      role: "assistant",
      content: `**Error:** ${error instanceof Error ? error.message : String(error)}`
    });
    renderChat();
    showToast("Error de conexión con el asistente.", "error");
  } finally {
    chatSendButton.disabled = false;
    chatInput.disabled = false;
    chatInput.focus();
  }
});

// UI Interactions
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event("submit"));
  }
});

sourcesHeader.addEventListener("click", () => {
  sourcesPanel.classList.toggle("open");
  sourcesContent.classList.toggle("hidden");
});

const pollHydrationStatus = async () => {
  try {
    await loadHydrationStatus();
    if (state.hydrationStatus?.isRunning) {
      await loadLibrary();
      if (state.selectedTaskId) {
        await loadSelectedTask();
      }
    }
  } catch {
    // Best effort UI polling only.
  }
};

setInterval(() => {
  pollHydrationStatus();
}, 3000);

// Init
Promise.all([loadLatest(), loadLibrary(), loadHydrationStatus()])
  .then(async () => {
    if (state.tasks.length > 0) {
      await selectTask(state.tasks[0].id);
    }
  })
  .catch((error) => {
    setStatus("Error", "error");
    renderWarnings([error instanceof Error ? error.message : String(error)]);
  });
