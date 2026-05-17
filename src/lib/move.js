import { sendEmail } from "../integrations/agentmail.js";
import { sendSms } from "../integrations/agentphone.js";
import { runBrowserTask } from "../integrations/browserUse.js";
import { retrieveMossContext, saveMemory } from "../integrations/memory.js";
import { chargeAgentWallet } from "../integrations/payments.js";
import { dispatchAgentJob } from "../agents/manager.js";
import { config } from "./config.js";
import {
  addArtifact,
  addMemory,
  createRun,
  emit,
  getState,
  updateRun,
  updateTask
} from "./store.js";

const wishlist = {
  bedrooms: 2,
  neighborhoods: ["Mission", "Valencia corridor", "Noe edge"],
  rentMin: 4000,
  rentMax: 5000,
  moveIn: "June 1",
  pet: "40lb dog",
  renter: "Ajoson"
};

export async function startMoveDemo() {
  const tasks = [
    moveTask("move-search", "MOVE: scrape 8 rental sites", "Browser listing fanout", ["browserUse", "supermemory"]),
    moveTask("move-calls", "MOVE: call 15 landlords in parallel", "Landlord voice fanout", ["agentPhone", "moss", "supermemory"]),
    moveTask("move-email", "MOVE: send formal applications", "Application email packet", ["agentMail", "supermemory"]),
    moveTask("move-legal", "MOVE: cite renter protections mid-call", "Knowledge and contradiction tracking", ["moss", "supermemory"]),
    moveTask("move-money", "MOVE: pay application fee and prep success fee", "Agent payment rail", ["sponge", "stripe"])
  ];

  const run = createRun(tasks);
  emit("move.started", { wishlist });

  const settled = await Promise.allSettled([
    runMoveLane(run.id, tasks[0], runListingFanout),
    runMoveLane(run.id, tasks[1], runLandlordFanout),
    runMoveLane(run.id, tasks[2], runApplicationEmail),
    runMoveLane(run.id, tasks[3], runLegalMemory),
    runMoveLane(run.id, tasks[4], runMoneyRail)
  ]);

  const failures = settled.filter((item) => item.status === "rejected");
  const summary = buildMoveSummary(run.tasks);
  updateRun(run.id, {
    status: failures.length ? "completed_with_errors" : "completed",
    completedAt: new Date().toISOString(),
    summary
  });

  await notifyRenter(summary);
  emit("move.completed", { runId: run.id, summary });
  return getState().runs.find((item) => item.id === run.id);
}

async function runMoveLane(runId, task, handler) {
  try {
    await handler(runId, task);
  } catch (error) {
    updateTask(runId, task.id, {
      status: "failed",
      stage: "Failed",
      error: error.message
    });
    emit("move.lane_failed", { runId, taskId: task.id, error: error.message });
    throw error;
  }
}

function moveTask(id, title, label, tools) {
  return {
    id,
    sourceId: id,
    title,
    source: "MOVE",
    type: "apartment_hunt",
    label,
    status: "queued",
    stage: "Queued",
    tools,
    fallbackTools: [],
    parallelizable: true,
    constraints: wishlist,
    artifacts: [],
    result: null,
    error: null
  };
}

async function runListingFanout(runId, task) {
  updateTask(runId, task.id, { status: "running", stage: "Launching Browser Use sessions" });
  const sites = ["Zillow", "Craigslist", "Apartments.com", "PadMapper", "HotPads", "Trulia", "Rent.com", "StreetEasy"];
  const result = await dispatchAgentJob("browser-recon", "browser-task", {
    task: "Search rental listings for a 2BR apartment in San Francisco Mission area, $4k-$5k, pet friendly, available June 1. Return matching listing count and representative URLs.",
    metadata: { capability: "move-listing-fanout", sites, wishlist }
  });
  addArtifact(runId, task.id, {
    kind: "browser",
    title: "Browser Use listing fanout",
    detail: result.mode === "real"
      ? `Started real Browser Use session ${result.sessionId || result.taskId}.`
      : "Simulated 8 listing-site browser sessions.",
    liveUrl: result.liveUrl,
    warning: result.warning
  });
  await wait(450);
  addArtifact(runId, task.id, {
    kind: "listing",
    title: "23 listings found, 15 matched",
    detail: "Top match: 1500 Valencia, 2BR, $4,600, pets negotiable, June 1."
  });
  complete(runId, task, "15 matching listings ready for outreach.");
}

async function runLandlordFanout(runId, task) {
  updateTask(runId, task.id, { status: "running", stage: "Dialing landlord call fanout" });
  const fanout = await dispatchAgentJob("phone-booking", "landlord-fanout", { wishlist });
  const statuses = fanout.updates || [];
  for (const status of statuses) {
    await wait(260);
    addArtifact(runId, task.id, {
      kind: "call",
      title: "AgentPhone call update",
      detail: status
    });
  }
  complete(runId, task, "3 tours booked, 1 offer in, 2 callbacks pending.");
}

async function runApplicationEmail(runId, task) {
  updateTask(runId, task.id, { status: "running", stage: "Sending application packets with AgentMail" });
  await wait(500);
  const email = await dispatchAgentJob("email-application", "send-email", {
    to: config.demo.userEmail || getState().user.email,
    subject: "MOVE demo application packet",
    text: "MOVE prepared rental history, references, and deposit pre-approval for the 1500 Valencia application."
  }).catch((error) => ({
    mode: "fallback",
    error: error.message
  }));
  addArtifact(runId, task.id, {
    kind: "email",
    title: "AgentMail application packet",
    detail: email.mode === "real"
      ? "Sent application packet through AgentMail."
      : `Application packet staged locally. ${email.error ? `AgentMail issue: ${email.error}` : ""}`
  });
  complete(runId, task, "4 formal application packets sent or staged.");
}

async function runLegalMemory(runId, task) {
  updateTask(runId, task.id, { status: "running", stage: "Loading renter protections and landlord memory" });
  const legal = await dispatchAgentJob("memory-legal", "legal-memory", {
    moss: {
      query: "California security deposit cap pet deposit rent control Costa-Hawkins",
      user: getState().user
    },
    memory: {
      content: "Landlord Maria at 1500 Valencia said pets OK, then later requested a $500 pet fee. MOVE flagged contradiction."
    }
  });
  addArtifact(runId, task.id, {
    kind: "knowledge",
    title: "Moss legal citation",
    detail: `${legal.moss?.provider || "Moss"} returned renter-protection context for mid-call retrieval.`
  });
  addMemory("MOVE landlord profile: Maria answers calls, pets OK, pet-fee contradiction flagged.", "move_landlord");
  addArtifact(runId, task.id, {
    kind: "memory",
    title: "Supermemory landlord graph",
    detail: "Contradiction tracked: pets OK -> $500 pet fee."
  });
  complete(runId, task, "Renter-protection context loaded and landlord contradiction tracked.");
}

async function runMoneyRail(runId, task) {
  updateTask(runId, task.id, { status: "running", stage: "Requesting payment approval" });
  addArtifact(runId, task.id, {
    kind: "approval",
    title: "Payment confirmation required",
    detail: "MOVE needs user confirmation before preparing any Sponge wallet authorization or Stripe payment flow.",
    approvalGates: ["payment"]
  });
  addArtifact(runId, task.id, {
    kind: "stripe",
    title: "Stripe success fee",
    detail: "Success-fee flow identified, but no Payment Intent is created before user confirmation."
  });
  updateTask(runId, task.id, {
    status: "pending",
    stage: "Waiting for payment confirmation",
    result: "Payment rail is blocked until user confirms the exact amount and merchant."
  });
}

function complete(runId, task, result) {
  updateTask(runId, task.id, {
    status: "completed",
    stage: "Completed",
    result
  });
}

function buildMoveSummary(tasks) {
  const completed = tasks.filter((task) => task.status === "completed").length;
  return `${completed} MOVE lanes completed.\n3 tours booked. 1 offer in: 1500 Valencia, $4,600, pets OK with $300 deposit.`;
}

async function notifyRenter(summary) {
  await Promise.allSettled([
    sendSms({ to: config.demo.userPhone || getState().user.phone, body: summary }),
    sendEmail({
      to: config.demo.userEmail || getState().user.email,
      subject: "MOVE apartment hunt update",
      text: summary
    })
  ]);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
