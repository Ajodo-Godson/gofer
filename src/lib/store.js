import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";

export const bus = new EventEmitter();
bus.setMaxListeners(100);

const state = {
  runs: [],
  activeRunId: null,
  user: null,
  tasks: [],
  seedTasks: [],
  memory: [],
  events: []
};

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

export function addMemory(content, type = "task") {
  const memory = { type, content, at: new Date().toISOString() };
  state.memory.push(memory);
  emit("memory.added", { memory });
  return memory;
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
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
  return clone(payload);
}
