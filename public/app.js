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
  els.testBrowserUse.textContent = "Opening DoorDash...";
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
  els.runStatus.className = `badge ${run.status === "running" ? "running" : ""}`;
  els.runDemo.disabled = run.status === "running";
  els.runDemo.textContent = run.status === "running" ? "Agents running..." : "Run GOFER demo";
  els.manualTaskSubmit.disabled = run.status === "running";
  els.manualTaskSubmit.textContent = run.status === "running" ? "Running..." : "Dispatch";
  const browserRunning = run.tasks.some((task) => task.type === "browser_test" && task.status === "running");
  els.testBrowserPortal.disabled = browserRunning;
  els.testBrowserPortal.textContent = browserRunning ? "Browser running..." : "Run Patient Portal";
  els.testBrowserUse.disabled = browserRunning;
  els.testBrowserUse.textContent = browserRunning ? "Browser running..." : "Run DoorDash Cart";

  els.agentLanes.className = "lanes";
  els.agentLanes.innerHTML = run.tasks.map(renderLane).join("");
}

function renderLane(task) {
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
      ${(task.artifacts || []).map(renderArtifact).join("")}
    </article>
  `;
}

function renderArtifact(artifact) {
  const liveUrl = normalizeLiveUrl(artifact.liveUrl || artifact.live_url);
  return `
    <div class="artifact">
      <div>
        <div class="artifact-title">${escapeHtml(artifact.title || artifact.kind)}</div>
        <div class="subtle">${escapeHtml(artifact.detail || "")}</div>
        ${artifact.actionRequired ? renderActionRequired(artifact.actionRequired) : ""}
        ${artifact.output ? `<pre class="artifact-output">${escapeHtml(artifact.output)}</pre>` : ""}
        ${artifact.warning ? `<div class="warning">${escapeHtml(artifact.warning)}</div>` : ""}
        ${liveUrl ? renderBrowserFrame(liveUrl) : ""}
      </div>
    </div>
  `;
}

function renderActionRequired(action) {
  return `
    <div class="warning">
      Action required: ${escapeHtml(action.message || "User authentication is required.")}
      ${action.blocker ? `<br>Blocker: ${escapeHtml(action.blocker)}` : ""}
    </div>
  `;
}

function renderBrowserFrame(liveUrl) {
  return `
    <div class="browser-live">
      <div class="browser-live-head">
        <span>Browser Use live session</span>
        <a href="${escapeHtml(liveUrl)}" target="_blank" rel="noreferrer">Open</a>
      </div>
      <iframe src="${escapeHtml(withBrowserUseChromeHidden(liveUrl))}" loading="lazy" title="Browser Use live session"></iframe>
    </div>
  `;
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

function withBrowserUseChromeHidden(value) {
  const url = new URL(value);
  url.searchParams.set("ui", "false");
  url.searchParams.set("theme", "light");
  return url.href;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
