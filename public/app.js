const syncButton = document.querySelector("#syncButton");
const statusPill = document.querySelector("#statusPill");
const meta = document.querySelector("#meta");
const tasksContainer = document.querySelector("#tasks");
const warningsContainer = document.querySelector("#warnings");
const sourcesContainer = document.querySelector("#sources");
const taskSelect = document.querySelector("#taskSelect");
const taskUrlInput = document.querySelector("#taskUrlInput");
const fetchDetailButton = document.querySelector("#fetchDetailButton");
const detailStatus = document.querySelector("#detailStatus");
const taskDetail = document.querySelector("#taskDetail");
const chatLog = document.querySelector("#chatLog");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const chatSendButton = document.querySelector("#chatSendButton");
const chatMeta = document.querySelector("#chatMeta");

const state = {
  snapshot: null,
  tasks: [],
  selectedTaskId: "",
  selectedDetail: null,
  chatThreadId: "",
  chatMessages: []
};

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
    sourcesContainer.textContent = "No hay fuentes inspeccionadas todavia.";
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

const renderTaskOptions = () => {
  const options = ['<option value="">Seleccionar tarea...</option>'];

  for (const task of state.tasks) {
    options.push(
      `<option value="${escapeHtml(task.id)}"${task.id === state.selectedTaskId ? " selected" : ""}>${escapeHtml(task.title)}</option>`
    );
  }

  taskSelect.innerHTML = options.join("");
};

const renderTasks = (tasks) => {
  if (!tasks?.length) {
    tasksContainer.className = "task-list empty";
    tasksContainer.innerHTML = "No se detectaron tareas pendientes con las heuristicas actuales.";
    return;
  }

  tasksContainer.className = "task-list";
  tasksContainer.innerHTML = tasks
    .map((task) => {
      const selected = task.id === state.selectedTaskId;
      return `
        <article class="task-card ${selected ? "selected" : ""}">
          <div class="task-topline">
            <span class="badge ${escapeHtml(task.status)}">${escapeHtml(task.status)}</span>
            <span class="source">${escapeHtml(task.sourcePage)}</span>
          </div>
          <h3>${escapeHtml(task.title)}</h3>
          <p class="meta-line">
            ${task.course ? `<span>${escapeHtml(task.course)}</span>` : ""}
            ${task.dueText ? `<span>${escapeHtml(task.dueText)}</span>` : ""}
          </p>
          ${task.description ? `<p class="description">${escapeHtml(task.description)}</p>` : ""}
          <div class="card-actions">
            <button type="button" class="secondary-button task-select-button" data-task-id="${escapeHtml(task.id)}">
              ${selected ? "Seleccionada" : "Usar contexto"}
            </button>
            ${task.url ? `<a href="${escapeHtml(task.url)}" target="_blank" rel="noreferrer">Abrir URL guardada</a>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
};

const renderSnapshot = (snapshot) => {
  if (!snapshot) {
    meta.textContent = "Todavia no hay datos guardados.";
    renderWarnings([]);
    renderTasks([]);
    renderSources([]);
    setStatus("Sin sincronizar", "idle");
    return;
  }

  meta.textContent = `Ultima sincronizacion: ${new Date(snapshot.savedAt).toLocaleString()}. ${snapshot.tasks.length} tareas detectadas.`;
  renderWarnings(snapshot.warnings ?? []);
  renderSources(snapshot.sources ?? []);
  setStatus(snapshot.requiresManualLogin ? "Login manual detectado" : "Sesion reutilizada", "success");
};

const renderTaskDetail = (detail) => {
  state.selectedDetail = detail;

  if (!detail) {
    taskDetail.className = "detail-card empty";
    taskDetail.innerHTML = "Todavia no hay detalle cargado.";
    return;
  }

  taskDetail.className = "detail-card";
  taskDetail.innerHTML = `
    <h3>${escapeHtml(detail.title || "Detalle de tarea")}</h3>
    ${detail.course ? `<p class="meta-line"><span>${escapeHtml(detail.course)}</span></p>` : ""}
    ${detail.metadata?.length ? `<div class="detail-metadata">${detail.metadata.map((item) => `<p><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</p>`).join("")}</div>` : ""}
    <div class="detail-block">
      <h4>Instrucciones</h4>
      <p>${escapeHtml(detail.instructionsText || "No se pudo extraer texto util.")}</p>
    </div>
    <div class="detail-block">
      <h4>Adjuntos detectados</h4>
      ${
        detail.attachments?.length
          ? detail.attachments
              .map((attachment) =>
                attachment.url
                  ? `<p><a href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer">${escapeHtml(attachment.name)}</a></p>`
                  : `<p>${escapeHtml(attachment.name)}</p>`
              )
              .join("")
          : "<p>No se detectaron adjuntos estructurados.</p>"
      }
    </div>
  `;
};

const renderChat = () => {
  if (!state.chatMessages.length) {
    chatLog.className = "chat-log empty";
    chatLog.textContent = "Todavia no hay mensajes.";
  } else {
    chatLog.className = "chat-log";
    chatLog.innerHTML = state.chatMessages
      .map(
        (message) => `
          <article class="chat-bubble ${escapeHtml(message.role)}">
            <span class="chat-role">${escapeHtml(message.role)}</span>
            <p>${escapeHtml(message.content)}</p>
          </article>
        `
      )
      .join("");
  }

  chatMeta.textContent = state.chatThreadId
    ? `Thread activo: ${state.chatThreadId}`
    : "Sin conversacion iniciada.";
};

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
  renderTaskOptions();
  renderTasks(state.tasks);
};

const loadSelectedTask = async () => {
  if (!state.selectedTaskId) {
    taskUrlInput.value = "";
    renderTaskDetail(null);
    return;
  }

  const response = await fetch(`/api/library/tasks/${encodeURIComponent(state.selectedTaskId)}`);
  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "No se pudo cargar la tarea.");
  }

  const task = payload.task;
  taskUrlInput.value = task?.url || "";
  renderTaskDetail(payload.detail ?? null);
};

const selectTask = async (taskId) => {
  state.selectedTaskId = taskId || "";
  renderTaskOptions();
  renderTasks(state.tasks);
  await loadSelectedTask();
};

syncButton.addEventListener("click", async () => {
  syncButton.disabled = true;
  setStatus("Sincronizando...", "loading");

  try {
    const response = await fetch("/api/tasks/sync", { method: "POST" });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "No se pudo sincronizar.");
    }

    state.snapshot = payload.snapshot;
    renderSnapshot(state.snapshot);
    await loadLibrary();
  } catch (error) {
    setStatus("Error", "error");
    renderWarnings([error instanceof Error ? error.message : String(error)]);
  } finally {
    syncButton.disabled = false;
  }
});

taskSelect.addEventListener("change", async (event) => {
  const nextTaskId = event.target.value;
  try {
    await selectTask(nextTaskId);
    detailStatus.textContent = nextTaskId
      ? "Contexto de tarea seleccionado. Si hace falta, pega la URL exacta de la evaluacion y toca Leer detalle."
      : "Selecciona una tarea o pega una URL de Blackboard.";
  } catch (error) {
    detailStatus.textContent = error instanceof Error ? error.message : String(error);
  }
});

tasksContainer.addEventListener("click", async (event) => {
  const button = event.target.closest(".task-select-button");
  if (!button) {
    return;
  }

  try {
    await selectTask(button.dataset.taskId || "");
  } catch (error) {
    detailStatus.textContent = error instanceof Error ? error.message : String(error);
  }
});

fetchDetailButton.addEventListener("click", async () => {
  const url = taskUrlInput.value.trim();
  if (!url) {
    detailStatus.textContent = "Pega una URL de Blackboard para leer el detalle.";
    return;
  }

  fetchDetailButton.disabled = true;
  detailStatus.textContent = "Leyendo detalle de la tarea...";

  try {
    const response = await fetch("/api/library/fetch-detail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: state.selectedTaskId || undefined,
        url
      })
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "No se pudo leer el detalle.");
    }

    if (!state.selectedTaskId && payload.detail?.taskId) {
      state.selectedTaskId = payload.detail.taskId;
    }

    await loadLibrary();
    await loadSelectedTask();
    detailStatus.textContent = "Detalle guardado en SQLite y listo para el chat.";
  } catch (error) {
    detailStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    fetchDetailButton.disabled = false;
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = chatInput.value.trim();
  if (!message) {
    return;
  }

  chatSendButton.disabled = true;
  state.chatMessages.push({ role: "user", content: message });
  renderChat();
  chatInput.value = "";

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

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "No se pudo enviar el mensaje.");
    }

    state.chatThreadId = payload.threadId;
    state.chatMessages.push({ role: "assistant", content: payload.reply });
    renderChat();
  } catch (error) {
    state.chatMessages.push({
      role: "assistant",
      content: error instanceof Error ? error.message : String(error)
    });
    renderChat();
  } finally {
    chatSendButton.disabled = false;
  }
});

Promise.all([loadLatest(), loadLibrary()])
  .then(async () => {
    if (state.tasks.length > 0) {
      await selectTask(state.tasks[0].id);
    }
  })
  .catch((error) => {
    setStatus("Error", "error");
    renderWarnings([error instanceof Error ? error.message : String(error)]);
  });
