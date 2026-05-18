const state = {
  data: null
};

const els = {
  runDemo: document.querySelector("#runDemo"),
  testBrowserPortal: document.querySelector("#testBrowserPortal"),
  testBrowserUse: document.querySelector("#testBrowserUse"),
  manualTaskForm: document.querySelector("#manualTaskForm"),
  manualTaskInput: document.querySelector("#manualTaskInput"),
  manualTaskSubmit: document.querySelector("#manualTaskSubmit"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  chatSubmit: document.querySelector("#chatSubmit"),
  chatMessages: document.querySelector("#chatMessages"),
  sourceForm: document.querySelector("#sourceForm"),
  sourceUrlInput: document.querySelector("#sourceUrlInput"),
  sourceTextInput: document.querySelector("#sourceTextInput"),
  sourceSubmit: document.querySelector("#sourceSubmit"),
  sourceStatus: document.querySelector("#sourceStatus"),
  runStatus: document.querySelector("#runStatus"),
  notionTasks: document.querySelector("#notionTasks"),
  integrations: document.querySelector("#integrations"),
  checklist: document.querySelector("#checklist"),
  agentLanes: document.querySelector("#agentLanes"),
  agentProcesses: document.querySelector("#agentProcesses"),
  memory: document.querySelector("#memory"),
  events: document.querySelector("#events")
};

els.runDemo.addEventListener("click", async () => {
  els.runDemo.disabled = true;
  els.runDemo.textContent = "Dispatching...";
  await fetch("/api/run-demo", { method: "POST" });
  await refresh();
});

els.testBrowserPortal.addEventListener("click", async () => {
  els.testBrowserPortal.disabled = true;
  els.testBrowserPortal.textContent = "Opening portal...";
  await fetch("/api/test-browser-portal", { method: "POST" });
  await refresh();
});

  els.testBrowserUse.addEventListener("click", async () => {
  els.testBrowserUse.disabled = true;
  els.testBrowserUse.textContent = "Finding options...";
  await fetch("/api/test-browser-use", { method: "POST" });
  await refresh();
});

els.manualTaskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = els.manualTaskInput.value.trim();
  if (!title) return;
  els.manualTaskSubmit.disabled = true;
  els.manualTaskSubmit.textContent = "Dispatching...";
  await fetch("/api/run-task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title })
  });
  await refresh();
});

els.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = els.chatInput.value.trim();
  if (!message) return;
  els.chatSubmit.disabled = true;
  els.chatSubmit.textContent = "Sending...";
  els.chatInput.value = "";
  await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  });
  els.chatSubmit.disabled = false;
  els.chatSubmit.textContent = "Send";
  await refresh();
});

els.sourceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = els.sourceUrlInput.value.trim();
  const text = els.sourceTextInput.value.trim();
  if (!url && !text) return;
  els.sourceSubmit.disabled = true;
  els.sourceSubmit.textContent = "Importing...";
  els.sourceStatus.textContent = "";
  const response = await fetch("/api/import-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, text })
  });
  const data = await response.json();
  els.sourceSubmit.disabled = false;
  els.sourceSubmit.textContent = "Import Tasks";
  els.sourceStatus.textContent = data.ok
    ? `Imported ${data.count} tasks from ${data.source}.`
    : data.error || "Import failed.";
  if (data.ok) {
    els.sourceTextInput.value = "";
    els.sourceUrlInput.value = "";
  }
  await refresh();
});

const stream = new EventSource("/api/events");
stream.onmessage = async () => {
  await refresh();
};

refresh();
setInterval(refresh, 3000);

async function refresh() {
  const response = await fetch("/api/state");
  state.data = await response.json();
  render();
}

function render() {
  renderTasks();
  renderIntegrations();
  renderChecklist();
  renderChat();
  renderRun();
  renderAgentProcesses();
  renderMemory();
  renderEvents();
}

function renderTasks() {
  els.notionTasks.innerHTML = state.data.tasks
    .map((task) => `
      <div class="task-row ${task.status === "done" ? "done" : ""}">
        <div>
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-notes">${escapeHtml(task.result || task.notes || "")}</div>
        </div>
        <span class="status ${task.status === "done" ? "completed" : ""}">${task.status}</span>
      </div>
    `)
    .join("");
}

function renderIntegrations() {
  const labels = {
    agentPhone: "AgentPhone",
    browserUse: "Browser Use",
    agentMail: "AgentMail",
    supermemory: "Supermemory",
    moss: "Moss",
    sponge: "Sponge",
    stripe: "Stripe"
  };

  els.integrations.innerHTML = Object.entries(labels)
    .map(([key, label]) => {
      const live = Boolean(state.data.integrations[key]);
      return `
        <div class="integration ${live ? "live" : ""}">
          <strong>${label}</strong>
          <span class="mode">${live ? "LIVE KEY" : "SIM MODE"}</span>
        </div>
      `;
    })
    .join("");
}

function renderChecklist() {
  const checklist = state.data.checklist || {};
  els.checklist.innerHTML = Object.entries(checklist)
    .filter(([, item]) => !item.ready || item.notes?.length)
    .map(([name, item]) => `
      <div class="check-item">
        <strong>${escapeHtml(name)}</strong>: ${
          item.ready
            ? escapeHtml(item.notes.join(", "))
            : `missing ${escapeHtml(item.missing.join(", ") || "nothing")}`
        }
      </div>
    `)
    .join("");
}

function renderRun() {
  const run = state.data.runs[0];
  if (!run) {
    els.runStatus.textContent = "Idle";
    els.runStatus.className = "badge";
    return;
  }

  els.runStatus.textContent = run.status;
  els.runStatus.className = `badge ${escapeHtml(run.status)}`;
  els.runDemo.disabled = run.status === "running";
  els.runDemo.textContent = run.status === "running" ? "Agents running..." : "Run GOFER demo";
  els.manualTaskSubmit.disabled = run.status === "running";
  els.manualTaskSubmit.textContent = run.status === "running" ? "Running..." : "Dispatch";
  const browserRunning = run.tasks.some((task) => task.type === "browser_test" && task.status === "running");
  els.testBrowserPortal.disabled = browserRunning;
  els.testBrowserPortal.textContent = browserRunning ? "Browser running..." : "Run Patient Portal";
  els.testBrowserUse.disabled = browserRunning;
  els.testBrowserUse.textContent = browserRunning ? "Browser running..." : "Find DoorDash Options";

  els.agentLanes.className = "lanes";
  els.agentLanes.innerHTML = run.tasks.map(renderLane).join("");
}

function renderLane(task) {
  const artifacts = (task.artifacts || []).filter((artifact) => artifact.kind !== "workflow");
  return `
    <article class="lane">
      <div class="lane-head">
        <div>
          <h3>${escapeHtml(task.title)}</h3>
          <div class="subtle">${escapeHtml(task.label)} · ${escapeHtml(task.source)}</div>
        </div>
        <span class="status ${task.status}">${escapeHtml(task.status)}</span>
      </div>
      <div class="tools">
        ${task.tools.map((tool) => `<span class="tool">${escapeHtml(tool)}</span>`).join("")}
      </div>
      <div class="stage">${escapeHtml(task.stage)}</div>
      <div class="subtle">${escapeHtml(task.result || task.error || "Waiting for artifacts...")}</div>
      ${artifacts.map(renderArtifact).join("")}
    </article>
  `;
}

function renderArtifact(artifact) {
  const liveUrl = normalizeLiveUrl(artifact.liveUrl || artifact.live_url);
  const title = artifact.kind === "browser" ? "Web research result" : artifact.title || artifact.kind;
  const recordingUrls = Array.isArray(artifact.recordingUrls)
    ? artifact.recordingUrls.filter((url) => typeof url === "string" && url.length > 0)
    : [];
  const memoryMatches = Array.isArray(artifact.matches)
    ? artifact.matches.filter((match) => match && typeof match.content === "string")
    : [];
  return `
    <div class="artifact">
      <div>
        <div class="artifact-title">${escapeHtml(title)}</div>
        <div class="subtle">${escapeHtml(artifact.detail || "")}</div>
        ${artifact.actionRequired ? renderActionRequired(artifact.actionRequired) : ""}
        ${artifact.output ? renderArtifactOutput(artifact.output) : ""}
        ${artifact.warning ? `<div class="warning">${escapeHtml(artifact.warning)}</div>` : ""}
        ${liveUrl ? renderLiveLink(liveUrl) : ""}
        ${recordingUrls.length ? renderRecordingLinks(recordingUrls) : ""}
        ${memoryMatches.length ? renderMemoryMatches(memoryMatches) : ""}
      </div>
    </div>
  `;
}

function renderMemoryMatches(matches) {
  return `
    <div class="memory-matches">
      ${matches.map((match) => `
        <div class="memory-match">
          <div class="memory-match-head">
            ${match.title ? `<strong>${escapeHtml(match.title)}</strong>` : `<strong>Memory match</strong>`}
            ${typeof match.score === "number" ? `<span class="subtle">score ${escapeHtml(match.score)}</span>` : ""}
          </div>
          <div class="subtle">${escapeHtml(truncateForDisplay(match.content, 220))}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function truncateForDisplay(value, max) {
  const str = String(value || "");
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function renderRecordingLinks(urls) {
  return `
    <div class="recording-links">
      ${urls.map((url, index) => `
        <a class="recording-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">
          Download MP4${urls.length > 1 ? ` (${index + 1})` : ""}
        </a>
      `).join("")}
      <div class="subtle">Presigned URL expires within 1 hour.</div>
    </div>
  `;
}

function renderArtifactOutput(output) {
  const parsed = parseJsonMaybe(output);
  if (parsed?.candidates?.length) {
    return `
      <div class="candidate-list">
        ${parsed.candidates.map((candidate) => `
          <div class="candidate">
            <div class="candidate-head">
              <strong>${escapeHtml(candidate.name || "Candidate")}</strong>
              <span>${escapeHtml(candidate.estimated_price_level || "")}</span>
            </div>
            <div class="subtle">${escapeHtml(candidate.neighborhood_address || "")}</div>
            <p>${escapeHtml(candidate.why_it_fits || "")}</p>
            <div class="subtle">${escapeHtml(candidate.likely_booking_channel || "")}</div>
            <div class="subtle">${escapeHtml(candidate.contact_info || "")}</div>
            <div class="availability">${escapeHtml(candidate.availability || "availability_not_verified")}</div>
          </div>
        `).join("")}
      </div>
      ${parsed.next_action ? `<div class="next-action">${escapeHtml(parsed.next_action)}</div>` : ""}
    `;
  }
  if (parsed?.options?.length) {
    return `
      <div class="candidate-list">
        ${parsed.options.map((option) => `
          <div class="candidate">
            <div class="candidate-head">
              <strong>${escapeHtml(option.restaurant_name || "Option")}</strong>
              <span>${escapeHtml(option.estimated_price || "")}</span>
            </div>
            <p>${escapeHtml(option.why_it_fits || "")}</p>
            <div class="subtle">${escapeHtml((option.food_choices || []).join(", "))}</div>
            <div class="availability">${escapeHtml(option.next_action || "Approve profile use to build the cart.")}</div>
          </div>
        `).join("")}
      </div>
      ${parsed.user_instruction ? `<div class="next-action">${escapeHtml(parsed.user_instruction)}</div>` : ""}
    `;
  }
  return `<details class="artifact-details"><summary>View structured output</summary><pre class="artifact-output">${escapeHtml(output)}</pre></details>`;
}

function renderActionRequired(action) {
  const authHint = action.type === "auth"
    ? `<br>Chat: if a Browser Use profile is already synced, reply <strong>approve profile</strong>. If not, sync once and restart GOFER.`
    : "";
  return `
    <div class="warning">
      Action required: ${escapeHtml(action.message || "User authentication is required.")}
      ${action.blocker ? `<br>Blocker: ${escapeHtml(action.blocker)}` : ""}
      ${authHint}
    </div>
  `;
}

function renderLiveLink(liveUrl) {
  return `
    <details class="artifact-details">
      <summary>Debug session link</summary>
      <a href="${escapeHtml(liveUrl)}" target="_blank" rel="noreferrer">Open browser session</a>
    </details>
  `;
}

function renderChat() {
  const messages = state.data.chat || [];
  els.chatMessages.innerHTML = messages.length
    ? messages.slice(-10).map((message) => `
      <div class="chat-message ${escapeHtml(message.role)}">
        <div class="chat-role">${message.role === "user" ? "You" : "GOFER"}</div>
        <div>${escapeHtml(message.content)}</div>
      </div>
    `).join("")
    : `<div class="empty-chat">After GOFER returns options, reply here with “yes”, “proceed”, or a specific choice.</div>`;
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function renderAgentProcesses() {
  const agents = state.data.agents || [];
  els.agentProcesses.innerHTML = agents
    .map((agent) => `
      <article class="agent-process ${agent.status}">
        <div class="agent-process-head">
          <div>
            <div class="agent-name">${escapeHtml(agent.name)}</div>
            <div class="subtle">${escapeHtml(agent.role)} · pid ${escapeHtml(agent.pid)}</div>
          </div>
          <span class="status ${agent.status}">${escapeHtml(agent.status)}</span>
        </div>
        <div class="agent-metrics">
          <span>queue ${escapeHtml(agent.queueDepth)}</span>
          <span>done ${escapeHtml(agent.completedJobs)}</span>
          <span>failed ${escapeHtml(agent.failedJobs)}</span>
        </div>
        <div class="subtle">memory: ${escapeHtml(agent.memoryScope)}</div>
        <div class="subtle">active: ${escapeHtml(agent.activeJobId || "none")}</div>
        <div class="subtle">last: ${escapeHtml(agent.lastResult || "none yet")}</div>
      </article>
    `)
    .join("");
}

function renderMemory() {
  els.memory.innerHTML = state.data.memory
    .slice(-8)
    .reverse()
    .map((item) => `<div class="memory-item">${escapeHtml(item.content)}</div>`)
    .join("");
}

function renderEvents() {
  els.events.innerHTML = state.data.events
    .slice(0, 35)
    .map((event) => `
      <div class="event-row">
        <div class="event-type">${escapeHtml(event.type)}</div>
        <div>
          <div class="event-time">${new Date(event.at).toLocaleTimeString()}</div>
          <div class="subtle">${summarizeEvent(event)}</div>
        </div>
      </div>
    `)
    .join("");
}

function summarizeEvent(event) {
  if (event.type === "browseruse.test" && event.payload?.liveUrl) return `Live browser: ${event.payload.liveUrl}`;
  if (event.payload?.task?.title) return event.payload.task.title;
  if (event.payload?.summary) return event.payload.summary.split("\n")[0];
  if (event.payload?.count) return `${event.payload.count} tasks planned`;
  if (event.payload?.memory?.content) return event.payload.memory.content;
  if (event.payload?.source) return event.payload.source;
  return event.type;
}

function normalizeLiveUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.href;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  const text = String(value).trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const candidates = [
    text,
    unfenced,
    unfenced.slice(unfenced.indexOf("{"), unfenced.lastIndexOf("}") + 1)
  ].filter((candidate) => candidate && candidate.includes("{"));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try next candidate.
    }
  }
  return null;
}
