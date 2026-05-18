import { EventEmitter } from "node:events";
import { readFile, writeFile } from "node:fs/promises";

export const bus = new EventEmitter();
bus.setMaxListeners(100);

const runtimeStatePath = "data/gofer-state.local.json";

const state = {
  runs: [],
  activeRunId: null,
  user: null,
  tasks: [],
  seedTasks: [],
  memory: [],
  chat: [],
  events: []
};

let persistTimer = null;
let stateLoaded = false;

export async function loadSeedData() {
  state.user = JSON.parse(await readFile("data/demo-user.json", "utf8"));
  state.seedTasks = JSON.parse(await readFile("data/notion-tasks.json", "utf8"));
  state.tasks = clone(state.seedTasks);
  state.memory = [
    {
      type: "profile",
      content: `${state.user.name} prefers morning or early afternoon appointments and uses ${state.user.insurance.dentalProvider}.`
    },
    {
      type: "provider",
      content: `${state.user.savedProviders.dentist.name} is the saved dentist. Phone ${state.user.savedProviders.dentist.phone}.`
    }
  ];
  await restoreRuntimeState();
  stateLoaded = true;
}

export function resetDemoTasks() {
  state.tasks = clone(state.seedTasks);
  emit("notion.reset", { tasks: state.tasks });
}

export function getState() {
  return state;
}

export function createRun(tasks) {
  const run = {
    id: `run-${Date.now()}`,
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    tasks,
    summary: null
  };
  state.runs.unshift(run);
  state.activeRunId = run.id;
  emit("run.created", { run });
  return run;
}

export function updateRun(runId, patch) {
  const run = state.runs.find((item) => item.id === runId);
  if (!run) return null;
  Object.assign(run, patch);
  emit("run.updated", { run });
  return run;
}

export function updateTask(runId, taskId, patch) {
  const run = state.runs.find((item) => item.id === runId);
  if (!run) return null;
  const task = run.tasks.find((item) => item.id === taskId);
  if (!task) return null;
  Object.assign(task, patch);
  emit("task.updated", { runId, task });
  return task;
}

export function addArtifact(runId, taskId, artifact) {
  const task = updateTask(runId, taskId, {});
  if (!task) return null;
  task.artifacts.push({
    id: `artifact-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    ...artifact
  });
  emit("task.artifact", { runId, taskId, artifact });
  return task;
}

export function completeSeedTask(sourceId, result) {
  const task = state.tasks.find((item) => item.id === sourceId);
  if (task) {
    task.status = "done";
    task.result = result;
  }
  emit("notion.updated", { tasks: state.tasks });
}

export function addMemory(content, type = "task", metadata = {}) {
  const memory = { type, content, metadata, at: new Date().toISOString() };
  state.memory.push(memory);
  emit("memory.added", { memory });
  return memory;
}

export function rememberBrowserProfileApproval({ taskTitle, runId, taskId }) {
  const content = `User approved using the synced Browser Use profile for: ${taskTitle}`;
  return addMemory(content, "browser_profile_permission", { runId, taskId });
}

export function addChatMessage(role, content, metadata = {}) {
  const message = {
    id: `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    metadata,
    at: new Date().toISOString()
  };
  state.chat.push(message);
  state.chat = state.chat.slice(-80);
  emit("chat.message", { message });
  return message;
}

export function replaceSourceTasks(tasks, source = "Imported") {
  state.seedTasks = tasks.map((task, index) => ({
    id: task.id || `imported-${Date.now()}-${index + 1}`,
    title: task.title,
    source,
    status: task.status || "todo",
    notes: task.notes || ""
  }));
  state.tasks = clone(state.seedTasks);
  emit("source.imported", { source, tasks: state.tasks });
  return state.tasks;
}

export function emit(type, payload) {
  const event = {
    id: `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    at: new Date().toISOString(),
    payload: compactPayload(type, payload)
  };
  state.events.unshift(event);
  state.events = state.events.slice(0, 200);
  bus.emit("event", event);
  schedulePersist();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function restoreRuntimeState() {
  try {
    const raw = await readFile(runtimeStatePath, "utf8");
    const saved = JSON.parse(raw);
    if (Array.isArray(saved.seedTasks) && saved.seedTasks.length) {
      state.seedTasks = saved.seedTasks;
    }
    if (Array.isArray(saved.tasks)) state.tasks = saved.tasks;
    if (Array.isArray(saved.runs)) state.runs = saved.runs;
    if (Array.isArray(saved.chat)) state.chat = saved.chat;
    if (Array.isArray(saved.events)) state.events = saved.events;
    if (Array.isArray(saved.memory)) state.memory = saved.memory;
    state.activeRunId = saved.activeRunId || state.runs[0]?.id || null;
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`GOFER could not restore runtime state: ${error.message}`);
    }
  }
}

function schedulePersist() {
  if (!stateLoaded) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistRuntimeState().catch((error) => {
      console.warn(`GOFER could not persist runtime state: ${error.message}`);
    });
  }, 100);
  persistTimer.unref?.();
}

async function persistRuntimeState() {
  const snapshot = {
    version: 1,
    savedAt: new Date().toISOString(),
    activeRunId: state.activeRunId,
    seedTasks: state.seedTasks,
    tasks: state.tasks,
    runs: state.runs.slice(0, 10),
    chat: state.chat.slice(-80),
    events: state.events.slice(0, 200),
    memory: state.memory.slice(-100)
  };
  await writeFile(runtimeStatePath, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function compactPayload(type, payload) {
  if (!payload) return {};
  if (type === "run.created" || type === "run.updated") {
    return {
      runId: payload.run?.id,
      status: payload.run?.status,
      taskCount: payload.run?.tasks?.length || 0,
      summary: payload.run?.summary || null
    };
  }
  if (type === "planner.completed") {
    return {
      count: payload.count,
      tasks: payload.tasks?.map((task) => ({
        id: task.id,
        title: task.title,
        type: task.type,
        tools: task.tools
      }))
    };
  }
  if (type === "task.updated") {
    return {
      runId: payload.runId,
      task: {
        id: payload.task?.id,
        title: payload.task?.title,
        status: payload.task?.status,
        stage: payload.task?.stage,
        result: payload.task?.result || null,
        error: payload.task?.error || null
      }
    };
  }
  if (type === "intake.completed") {
    return {
      count: payload.notion?.tasks?.length || 0,
      provider: payload.notion?.provider,
      mode: payload.notion?.mode
    };
  }
  if (type === "notion.updated" || type === "notion.reset") {
    return {
      tasks: payload.tasks?.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status
      }))
    };
  }
  if (type === "browseruse.test") {
    return {
      mode: payload.mode,
      sessionId: payload.sessionId,
      taskId: payload.taskId,
      liveUrl: payload.liveUrl,
      warning: payload.warning || null
    };
  }
  if (type === "chat.message") {
    return {
      message: {
        role: payload.message?.role,
        content: payload.message?.content
      }
    };
  }
  if (type === "source.imported") {
    return {
      source: payload.source,
      count: payload.tasks?.length || 0
    };
  }
  return clone(payload);
}
