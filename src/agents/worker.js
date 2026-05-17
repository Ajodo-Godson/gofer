import "../lib/env.js";
import { placeCall } from "../integrations/agentphone.js";
import { runBrowserTask, runDoorDashCartDemo, runDoorDashDiscoveryDemo, runPatientPortalDemo } from "../integrations/browserUse.js";
import { sendEmail } from "../integrations/agentmail.js";
import { retrieveMossContext, saveMemory, searchMemory } from "../integrations/memory.js";
import { chargeAgentWallet } from "../integrations/payments.js";

const identity = {
  id: process.env.GOFER_AGENT_ID,
  name: process.env.GOFER_AGENT_NAME,
  role: process.env.GOFER_AGENT_ROLE,
  memoryScope: process.env.GOFER_AGENT_MEMORY_SCOPE
};

const localMemory = [];
const queue = [];
let active = false;

process.send?.({
  kind: "ready",
  identity,
  pid: process.pid
});

setInterval(() => {
  process.send?.({
    kind: "heartbeat",
    identity,
    queueDepth: queue.length,
    active
  });
}, 5000).unref();

process.on("message", (message) => {
  if (message.kind !== "job") return;
  queue.push(message);
  drainQueue();
});

async function drainQueue() {
  if (active) return;
  const job = queue.shift();
  if (!job) return;
  active = true;
  process.send?.({ kind: "job_started", jobId: job.jobId, type: job.type, identity });

  try {
    const result = await handleJob(job);
    localMemory.push({
      at: new Date().toISOString(),
      type: job.type,
      summary: result?.summary || result?.result || "completed"
    });
    process.send?.({ kind: "job_completed", jobId: job.jobId, type: job.type, result, identity });
  } catch (error) {
    process.send?.({ kind: "job_failed", jobId: job.jobId, type: job.type, error: error.message, identity });
  } finally {
    active = false;
    drainQueue();
  }
}

async function handleJob(job) {
  if (identity.role === "browser") {
    return handleBrowserJob(job);
  }
  if (identity.role === "phone") {
    return handlePhoneJob(job);
  }
  if (identity.role === "email") {
    return handleEmailJob(job);
  }
  if (identity.role === "memory") {
    return handleMemoryJob(job);
  }
  if (identity.role === "payment") {
    return handlePaymentJob(job);
  }
  throw new Error(`Unsupported agent role: ${identity.role}`);
}

async function handleBrowserJob(job) {
  const options = {
    onSessionStart: (progress) => {
      process.send?.({
        kind: "job_progress",
        jobId: job.jobId,
        type: job.type,
        progress: { phase: "browser-session-started", ...progress },
        identity
      });
    }
  };
  if (job.type === "doordash-discovery") return runDoorDashDiscoveryDemo(options);
  if (job.type === "doordash-cart") return runDoorDashCartDemo(options);
  if (job.type === "patient-portal") return runPatientPortalDemo(options);
  return runBrowserTask(job.payload, options);
}

async function handlePhoneJob(job) {
  if (job.type === "appointment-call") {
    return placeCall(job.payload);
  }
  if (job.type === "landlord-fanout") {
    await wait(900);
    return {
      result: "3 tours booked, 1 offer in, 2 callbacks pending.",
      updates: [
        "Maria answered: pets OK with deposit",
        "Leasing office IVR navigated",
        "Two landlords went to voicemail",
        "Five tour slots found",
        "One rent reduction opportunity flagged"
      ]
    };
  }
  throw new Error(`Unsupported phone job: ${job.type}`);
}

async function handleEmailJob(job) {
  return sendEmail(job.payload);
}

async function handleMemoryJob(job) {
  if (job.type === "search-memory") {
    return searchMemory(job.payload);
  }
  if (job.type === "moss-context") {
    return retrieveMossContext(job.payload);
  }
  if (job.type === "save-memory") {
    return saveMemory(job.payload);
  }
  if (job.type === "legal-memory") {
    const moss = await retrieveMossContext(job.payload.moss);
    const saved = await saveMemory(job.payload.memory);
    return {
      moss,
      saved,
      result: "Renter-protection context loaded and landlord contradiction tracked."
    };
  }
  throw new Error(`Unsupported memory job: ${job.type}`);
}

async function handlePaymentJob(job) {
  if (!job.payload?.approvalToken) {
    return {
      mode: "blocked",
      provider: "PaymentAgent",
      success: false,
      status: "approval_required",
      amount: job.payload?.amount,
      description: job.payload?.description,
      blocker: "User payment confirmation is required before the PaymentAgent can run this job."
    };
  }
  return chargeAgentWallet(job.payload);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
