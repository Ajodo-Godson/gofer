import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { emit } from "../lib/store.js";

const AGENTS = [
  {
    id: "browser-recon",
    name: "BrowserReconAgent",
    role: "browser",
    memoryScope: "browser.sessions"
  },
  {
    id: "phone-booking",
    name: "PhoneBookingAgent",
    role: "phone",
    memoryScope: "voice.appointments"
  },
  {
    id: "email-application",
    name: "EmailApplicationAgent",
    role: "email",
    memoryScope: "email.threads"
  },
  {
    id: "memory-legal",
    name: "MemoryLegalAgent",
    role: "memory",
    memoryScope: "knowledge.landlords"
  },
  {
    id: "payment",
    name: "PaymentAgent",
    role: "payment",
    memoryScope: "payments.wallet"
  }
];

const agents = new Map();
const pendingJobs = new Map();

export function startAgents() {
  for (const definition of AGENTS) {
    if (agents.has(definition.id)) continue;
    spawnAgent(definition);
  }
}

export function stopAgents() {
  for (const agent of agents.values()) {
    agent.process.kill();
  }
  agents.clear();
}

export function getAgentSnapshots() {
  return [...agents.values()].map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    pid: agent.process.pid,
    status: agent.status,
    queueDepth: agent.queueDepth,
    activeJobId: agent.activeJobId,
    completedJobs: agent.completedJobs,
    failedJobs: agent.failedJobs,
    memoryScope: agent.memoryScope,
    lastHeartbeatAt: agent.lastHeartbeatAt,
    lastResult: agent.lastResult
  }));
}

export function dispatchAgentJob(agentId, type, payload, options = {}) {
  const agent = agents.get(agentId);
  if (!agent) {
    return Promise.reject(new Error(`Agent ${agentId} is not running`));
  }

  const jobId = `${agentId}-${Date.now()}-${randomUUID()}`;
  const message = { kind: "job", jobId, type, payload };

  const promise = new Promise((resolve, reject) => {
    pendingJobs.set(jobId, { resolve, reject, agentId, onProgress: options.onProgress });
  });

  agent.queueDepth += 1;
  agent.process.send(message);
  emit("agent.job_queued", {
    agentId,
    agentName: agent.name,
    jobId,
    type,
    queueDepth: agent.queueDepth
  });

  return promise;
}

function spawnAgent(definition) {
  const workerPath = join(process.cwd(), "src", "agents", "worker.js");
  const child = fork(workerPath, [], {
    env: {
      ...process.env,
      GOFER_AGENT_ID: definition.id,
      GOFER_AGENT_NAME: definition.name,
      GOFER_AGENT_ROLE: definition.role,
      GOFER_AGENT_MEMORY_SCOPE: definition.memoryScope
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });

  const agent = {
    ...definition,
    process: child,
    status: "starting",
    queueDepth: 0,
    activeJobId: null,
    completedJobs: 0,
    failedJobs: 0,
    lastHeartbeatAt: null,
    lastResult: null
  };
  agents.set(definition.id, agent);

  child.stdout.on("data", (chunk) => {
    emit("agent.log", {
      agentId: definition.id,
      stream: "stdout",
      message: chunk.toString("utf8").trim()
    });
  });

  child.stderr.on("data", (chunk) => {
    emit("agent.log", {
      agentId: definition.id,
      stream: "stderr",
      message: chunk.toString("utf8").trim()
    });
  });

  child.on("message", (message) => handleAgentMessage(agent, message));
  child.on("exit", (code, signal) => {
    agent.status = "exited";
    emit("agent.exited", { agentId: agent.id, code, signal });
  });
}

function handleAgentMessage(agent, message) {
  if (message.kind === "ready") {
    agent.status = "idle";
    agent.lastHeartbeatAt = new Date().toISOString();
    emit("agent.ready", snapshotEvent(agent));
    return;
  }

  if (message.kind === "heartbeat") {
    agent.lastHeartbeatAt = new Date().toISOString();
    return;
  }

  if (message.kind === "job_started") {
    agent.status = "running";
    agent.queueDepth = Math.max(0, agent.queueDepth - 1);
    agent.activeJobId = message.jobId;
    emit("agent.job_started", snapshotEvent(agent, message));
    return;
  }

  if (message.kind === "job_progress") {
    const pending = pendingJobs.get(message.jobId);
    pending?.onProgress?.(message.progress);
    emit("agent.job_progress", snapshotEvent(agent, message));
    return;
  }

  if (message.kind === "job_completed") {
    agent.status = "idle";
    agent.activeJobId = null;
    agent.completedJobs += 1;
    agent.lastResult = message.result?.summary || message.result?.result || message.type || "completed";
    const pending = pendingJobs.get(message.jobId);
    pendingJobs.delete(message.jobId);
    pending?.resolve(message.result);
    emit("agent.job_completed", snapshotEvent(agent, message));
    return;
  }

  if (message.kind === "job_failed") {
    agent.status = "idle";
    agent.activeJobId = null;
    agent.failedJobs += 1;
    const pending = pendingJobs.get(message.jobId);
    pendingJobs.delete(message.jobId);
    pending?.reject(new Error(message.error));
    emit("agent.job_failed", snapshotEvent(agent, message));
  }
}

function snapshotEvent(agent, extra = {}) {
  return {
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    pid: agent.process.pid,
    status: agent.status,
    queueDepth: agent.queueDepth,
    activeJobId: agent.activeJobId,
    completedJobs: agent.completedJobs,
    failedJobs: agent.failedJobs,
    memoryScope: agent.memoryScope,
    ...extra
  };
}
