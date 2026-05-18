import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import "./lib/env.js";
import { config, integrationStatus, setupChecklist } from "./lib/config.js";
import { getAgentSnapshots, startAgents, stopAgents } from "./agents/manager.js";
import { isBrowserUseDemoRunning, startBrowserUseDemo } from "./lib/browserUseDemo.js";
import { startDemoRun, startManualRun } from "./lib/orchestrator.js";
import { importTasksFromSource } from "./lib/taskSource.js";
import { saveMemory } from "./integrations/memory.js";
import { addArtifact, addChatMessage, addMemory, bus, emit, getState, loadSeedData, rememberBrowserProfileApproval, replaceSourceTasks, updateRun, updateTask } from "./lib/store.js";
import { summarizeCallState, voiceReply } from "./lib/voiceController.js";

const root = process.cwd();
const publicDir = join(root, "public");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

await loadSeedData();
startAgents();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/state") {
      return json(res, {
        ...getState(),
        agents: getAgentSnapshots(),
        integrations: integrationStatus(),
        checklist: setupChecklist()
      });
    }

    if (url.pathname === "/api/run-demo" && req.method === "POST") {
      json(res, { ok: true, message: "GOFER run started." });
      startDemoRun().catch((error) => {
        emit("run.error", { error: error.message });
      });
      return;
    }

    if (url.pathname === "/api/run-carl-demo" && req.method === "POST") {
      json(res, { ok: true, message: "GOFER Dr. Carl phone-only demo started." });
      startDemoRun({ onlySourceIds: ["notion-4"] }).catch((error) => {
        emit("run.error", { error: error.message });
      });
      return;
    }

    if (url.pathname === "/api/run-task" && req.method === "POST") {
      const body = await readJson(req);
      const title = String(body.title || "").trim();
      if (!title) return json(res, { ok: false, error: "Task title is required." }, 400);
      json(res, { ok: true, message: "GOFER manual task started." });
      startManualRun(title).catch((error) => {
        emit("run.error", { error: error.message });
      });
      return;
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      const body = await readJson(req);
      const message = String(body.message || "").trim();
      if (!message) return json(res, { ok: false, error: "Message is required." }, 400);
      const reply = await handleUserChat(message);
      return json(res, { ok: true, reply });
    }

    if (url.pathname === "/api/import-tasks" && req.method === "POST") {
      const body = await readJson(req);
      const imported = await importTasksFromSource({
        text: body.text,
        url: body.url,
        sourceName: body.sourceName
      });
      const tasks = replaceSourceTasks(imported.tasks, imported.source);
      return json(res, {
        ok: true,
        source: imported.source,
        count: tasks.length,
        tasks
      });
    }

    if (url.pathname === "/api/cancel-task" && req.method === "POST") {
      const state = getState();
      const activeRun = state.runs[0];
      const task = activeRun?.tasks?.find((t) => ["pending", "running"].includes(t.status));
      if (!task) return json(res, { ok: false, error: "No active task to cancel." }, 404);
      updateTask(activeRun.id, task.id, {
        status: "cancelled",
        stage: "Cancelled",
        result: "Cancelled by user."
      });
      updateRun(activeRun.id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        summary: "Task cancelled by user."
      });
      emit("task.cancelled", { runId: activeRun.id, taskId: task.id });
      return json(res, { ok: true });
    }

    if (url.pathname === "/api/test-browser-use" && req.method === "POST") {
      if (isBrowserUseDemoRunning()) {
        return json(res, { ok: false, message: "Browser Use demo is already running." }, 409);
      }
      json(res, { ok: true, message: "Browser Use DoorDash cart demo started." });
      startBrowserUseDemo("doordash").catch((error) => {
        emit("run.error", { error: error.message });
      });
      return;
    }

    if (url.pathname === "/api/test-browser-portal" && req.method === "POST") {
      if (isBrowserUseDemoRunning()) {
        return json(res, { ok: false, message: "Browser Use demo is already running." }, 409);
      }
      json(res, { ok: true, message: "Browser Use patient portal demo started." });
      startBrowserUseDemo("portal").catch((error) => {
        emit("run.error", { error: error.message });
      });
      return;
    }

    if (
      ["/api/agentphone/webhook", "/webhooks/agentphone", "/webhooks/sms"].includes(url.pathname) &&
      req.method === "POST"
    ) {
      return handleAgentPhoneWebhook(req, res);
    }

    if (
      ["/api/agentmail/webhook", "/webhooks/agentmail"].includes(url.pathname) &&
      req.method === "POST"
    ) {
      return handleAgentMailWebhook(req, res);
    }

    if (url.pathname === "/api/events") {
      return eventStream(req, res);
    }

    return staticFile(url.pathname, res);
  } catch (error) {
    console.error(error);
    json(res, { error: error.message }, 500);
  }
});

server.listen(config.port, () => {
  console.log(`GOFER live at http://localhost:${config.port}`);
  console.log(`Mode: ${Object.entries(integrationStatus()).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "simulated integrations"}`);
});

process.on("SIGINT", () => {
  stopAgents();
  process.exit(0);
});

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function handleAgentPhoneWebhook(req, res) {
  const rawBody = await readRawBody(req);
  const signature = req.headers["x-webhook-signature"];

  if (config.agentPhone.webhookSecret && !verifyAgentPhoneSignature(rawBody, signature)) {
    return json(res, { error: "Invalid webhook signature" }, 401);
  }

  const body = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
  let voiceResponse = null;
  if (body.channel === "voice" || body.event?.includes("voice") || body.event?.includes("call")) {
    voiceResponse = voiceReply(body);
  }
  const call = summarizeCallState(body);
  emit("agentphone.webhook", {
    event: body.event,
    channel: body.channel,
    agentId: body.agentId,
    direction: body.data?.direction,
    from: body.data?.from,
    message: body.data?.message || null,
    call
  });
  reconcileCallState(call);

  if (voiceResponse) {
    return json(res, voiceResponse);
  }

  if (body.channel === "sms" && body.data?.direction === "inbound") {
    startDemoRun().catch((error) => {
      emit("run.error", { error: error.message });
    });
  }

  return json(res, {
    ok: true,
    message: "GOFER received the AgentPhone webhook."
  });
}

function reconcileCallState(call) {
  if (!call?.taskId) return;
  const state = getState();
  const run = state.runs.find((item) => item.tasks?.some((task) => task.id === call.taskId));
  const task = run?.tasks?.find((item) => item.id === call.taskId);
  if (!run || !task || task.status === "completed") return;

  addArtifact(run.id, task.id, {
    kind: "call",
    title: "AgentPhone call update",
    detail: call.completed
      ? summarizeCompletedCall(call)
      : `Call in progress: ${call.phase || "active"}.`,
    output: call
  });

  if (!call.completed) {
    updateTask(run.id, task.id, {
      status: "running",
      stage: "Phone call in progress"
    });
    return;
  }

  const result = summarizeCompletedCall(call);
  updateTask(run.id, task.id, {
    status: "completed",
    stage: "Completed",
    result
  });
  updateRun(run.id, {
    status: "completed",
    completedAt: new Date().toISOString(),
    summary: `1 tasks done.\nDone: ${result}`
  });
  addMemory(`${task.title}: ${result}`, "completed_task", {
    source: "agentphone_webhook",
    runId: run.id,
    taskId: task.id
  });
  addChatMessage("assistant", result, {
    runId: run.id,
    taskId: task.id,
    action: "phone_call_completed"
  });
}

function summarizeCompletedCall(call) {
  if (call.kind === "appointment") {
    return call.offeredTime
      ? `Phone call completed: appointment time confirmed around ${call.offeredTime}.`
      : "Phone call completed: appointment outcome confirmed.";
  }
  return call.capturedAnswer
    ? `Phone call completed: ${call.capturedAnswer}`
    : "Phone call completed.";
}

function verifyAgentPhoneSignature(rawBody, signature) {
  if (!signature || typeof signature !== "string") return false;
  const expected = `sha256=${createHmac("sha256", config.agentPhone.webhookSecret)
    .update(rawBody)
    .digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
}

async function handleAgentMailWebhook(req, res) {
  // Read body with a hard cap so the endpoint is not a free DoS target.
  // 1 MB is well above AgentMail's typical message-received payload but
  // bounded enough that a misbehaving caller cannot exhaust memory.
  const limit = 1 * 1024 * 1024;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      return json(res, { error: "Request body too large" }, 413);
    }
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks);

  // Fail closed: refuse to act on unsigned events. Webhook secret is required.
  if (!config.agentMail.webhookSecret) {
    return json(res, { error: "AgentMail webhook secret not configured" }, 503);
  }
  const verification = verifyAgentMailSignature(rawBody, req.headers);
  if (!verification.ok) {
    return json(res, { error: "Invalid webhook signature" }, 401);
  }

  let payload;
  try {
    payload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
  } catch {
    return json(res, { error: "Invalid JSON" }, 400);
  }

  const inbound = parseInboundEmailEvent(payload);
  if (!inbound) {
    // Ack non-message events so AgentMail does not retry, but emit a low-noise
    // event so we can see what came through.
    emit("agentmail.webhook", {
      eventType: payload?.event_type || payload?.eventType || "unknown",
      handled: false
    });
    return json(res, { ok: true, handled: false });
  }

  emit("agentmail.received", {
    eventType: inbound.eventType,
    eventId: inbound.eventId,
    inboxId: inbound.inboxId,
    threadId: inbound.threadId,
    messageId: inbound.messageId,
    inReplyTo: inbound.inReplyTo,
    from: inbound.from,
    subject: inbound.subject,
    preview: inbound.preview,
    receivedAt: inbound.receivedAt
  });

  // Surface the reply to the user in chat. Read-only: we never auto-reply,
  // never act on the contents - that would need its own approval flow.
  surfaceInboundEmailToChat(inbound);

  return json(res, { ok: true, handled: true });
}

// Posts an assistant chat message describing the inbound email and tries to
// link it to a recently-active task so the user can spot a relevant reply.
// Best-effort - if we cannot find a sensible task, the message still goes
// out so the user sees that an email arrived.
function surfaceInboundEmailToChat(inbound) {
  const state = getState();
  const linkedTask = findLinkedTaskForInboundEmail(state, inbound);
  const fromLabel = inbound.from || "an unknown sender";
  const subjectLabel = inbound.subject ? `“${inbound.subject}”` : "(no subject)";
  const previewLabel = inbound.preview
    ? ` Preview: “${truncate(inbound.preview, 220)}”.`
    : "";
  const taskLine = linkedTask
    ? ` This may be related to: ${linkedTask.title}.`
    : "";
  const content = `Got an email reply from ${fromLabel}. Subject: ${subjectLabel}.${taskLine}${previewLabel} I will not act on this until you tell me to.`;

  addChatMessage("assistant", content, {
    source: "agentmail.received",
    threadId: inbound.threadId || null,
    messageId: inbound.messageId || null,
    inReplyTo: inbound.inReplyTo || null,
    from: inbound.from || null,
    subject: inbound.subject || null,
    runId: linkedTask?.runId || null,
    taskId: linkedTask?.taskId || null
  });
}

// Heuristic: prefer a task that is awaiting a response (status pending /
// awaiting_approval / running) and whose title shares meaningful words with
// the email subject. Falls back to the most recent run's first task. Returns
// null if there is no active run at all.
function findLinkedTaskForInboundEmail(state, inbound) {
  const runs = state.runs || [];
  if (runs.length === 0) return null;

  const subjectTokens = tokenize(inbound.subject);
  const candidateStatuses = new Set(["pending", "awaiting_approval", "running"]);

  // Score: status weight + token overlap with subject.
  let best = null;
  for (const run of runs) {
    for (const task of run.tasks || []) {
      const statusScore = candidateStatuses.has(task.status) ? 2 : 0;
      const titleTokens = tokenize(task.title);
      const overlap = subjectTokens.filter((token) => titleTokens.includes(token)).length;
      const score = statusScore + overlap;
      if (score === 0) continue;
      if (!best || score > best.score) {
        best = { score, runId: run.id, taskId: task.id, title: task.title };
      }
    }
  }
  if (best) return best;

  // No score; default to the most recent run's first task so the user has a
  // pointer rather than an orphan message.
  const fallback = runs[0]?.tasks?.[0];
  if (!fallback) return null;
  return { score: 0, runId: runs[0].id, taskId: fallback.id, title: fallback.title };
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function truncate(value, max) {
  const str = String(value || "");
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

async function handleUserChat(message) {
  addChatMessage("user", message);
  const state = getState();
  const activeRun = state.runs[0];
  const task = activeRun?.tasks?.[0];
  const approval = latestApprovalArtifact(task);
  const authHandoff = latestAuthHandoff(task);

  if (isNewErrandRequest(message)) {
    const reply = "Starting that as a new GOFER errand. I will return options first and stop before checkout, payment, booking, or any final submission.";
    addChatMessage("assistant", reply, { action: "new_errand_from_chat", priorRunId: activeRun?.id || null });
    startManualRun(message).catch((error) => {
      emit("run.error", { error: error.message });
    });
    return reply;
  }

  if (/^\s*cancel\s*$/i.test(message)) {
    if (task && ["pending", "running"].includes(task.status)) {
      updateTask(activeRun.id, task.id, {
        status: "cancelled",
        stage: "Cancelled",
        result: "Cancelled by user."
      });
      updateRun(activeRun.id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        summary: "Task cancelled by user."
      });
      emit("task.cancelled", { runId: activeRun.id, taskId: task.id });
      const reply = "Task cancelled. GOFER stopped all pending work.";
      addChatMessage("assistant", reply, { runId: activeRun.id, taskId: task.id, action: "task_cancelled" });
      return reply;
    }
    const reply = "Nothing active to cancel right now.";
    addChatMessage("assistant", reply);
    return reply;
  }

  if (!task || (!approval && !authHandoff)) {
    const reply = "I do not have a pending approval gate right now. Dispatch an errand first, then reply here to approve, change, or continue it.";
    addChatMessage("assistant", reply);
    return reply;
  }

  if (isNegative(message)) {
    const reply = "Got it. I will not proceed. Tell me what to change, or dispatch a new errand.";
    addChatMessage("assistant", reply, { runId: activeRun.id, taskId: task.id, action: "approval_declined" });
    updateTask(activeRun.id, task.id, {
      status: "cancelled",
      stage: "Approval declined",
      result: "User declined the pending approval gate."
    });
    updateRun(activeRun.id, {
      status: "completed",
      completedAt: new Date().toISOString(),
      summary: "Approval declined. GOFER stopped before taking the next action."
    });
    emit("approval.declined", { runId: activeRun.id, taskId: task.id, message });
    return reply;
  }

  const selected = selectCandidateFromMessage(task, message);
  if (task?.type === "browser_test" && /doordash/i.test(task.title) && selected) {
    return handleDoorDashOptionSelection({ selected, activeRun, task });
  }

  if (authHandoff) {
    return handleAuthChat({ message, activeRun, task, authHandoff });
  }

  if (task?.type === "browser_test" && /doordash/i.test(task.title) && isAffirmative(message)) {
    return handleDoorDashCartApproval({ message, activeRun, task });
  }

  if (task?.type === "browser_test" && /doordash/i.test(task.title) && /retry|again|rerun|try again/i.test(message)) {
    const reply = "Retrying DoorDash public discovery with search snippets only. I will not sign in, add to cart, checkout, or pay.";
    addChatMessage("assistant", reply, {
      runId: activeRun.id,
      taskId: task.id,
      action: "doordash_discovery_retry_started"
    });
    updateTask(activeRun.id, task.id, {
      status: "cancelled",
      stage: "Retry superseded this run",
      result: "Retry started for DoorDash public discovery."
    });
    updateRun(activeRun.id, {
      status: "completed",
      completedAt: new Date().toISOString(),
      summary: "Retry started for DoorDash public discovery."
    });
    startBrowserUseDemo("doordash").catch((error) => {
      emit("run.error", { error: error.message });
    });
    return reply;
  }

  if (task?.type !== "browser_test" && isRetry(message)) {
    const reply = "Retrying the browser step now. GOFER will keep the same safety gates and stop before checkout, payment, booking, submission, or any final commitment.";
    addChatMessage("assistant", reply, {
      runId: activeRun.id,
      taskId: task.id,
      action: "browser_workflow_retry_started"
    });
    updateTask(activeRun.id, task.id, {
      status: "cancelled",
      stage: "Retry superseded this run",
      result: "Retry started for the browser workflow."
    });
    updateRun(activeRun.id, {
      status: "completed",
      completedAt: new Date().toISOString(),
      summary: "Retry started for the browser workflow."
    });
    startManualRun(task.title).catch((error) => {
      emit("run.error", { error: error.message });
    });
    return reply;
  }

  if (task?.type === "product_discovery" && /retry|again|rerun|try again|continue/i.test(message)) {
    const reply = "Retrying product discovery with the search-first browser workflow. I will return options only and stop before cart, checkout, payment, or order submission.";
    addChatMessage("assistant", reply, {
      runId: activeRun.id,
      taskId: task.id,
      action: "product_discovery_retry_started"
    });
    updateTask(activeRun.id, task.id, {
      status: "cancelled",
      stage: "Retry superseded this run",
      result: "Retry started with search-first product discovery."
    });
    updateRun(activeRun.id, {
      status: "completed",
      completedAt: new Date().toISOString(),
      summary: "Retry started with search-first product discovery."
    });
    startManualRun(task.title).catch((error) => {
      emit("run.error", { error: error.message });
    });
    return reply;
  }

  if (["purchase", "billing_dispute"].includes(task?.type) && isAffirmative(message)) {
    return handleIrreversibleApproval({ message, activeRun, task });
  }

  if (isAffirmative(message) || selected) {
    const restaurant = selected || approval.recommendation || "the recommended option";
    const followup = buildFollowupTask(task, restaurant);
    const reply = buildApprovalAcceptedReply(task, restaurant);
    addChatMessage("assistant", reply, {
      runId: activeRun.id,
      taskId: task.id,
      action: "approval_accepted",
      restaurant
    });
    emit("approval.accepted", { runId: activeRun.id, taskId: task.id, restaurant, followup });
    startManualRun(followup).catch((error) => {
      emit("run.error", { error: error.message });
    });
    return reply;
  }

  const reply = "I found a pending approval gate, but I could not tell which option you want. Reply with the option name, or say yes to approve the recommended option.";
  addChatMessage("assistant", reply, { runId: activeRun.id, taskId: task.id, action: "approval_clarify" });
  return reply;
}

function handleDoorDashOptionSelection({ selected, activeRun, task }) {
  const hasProfile = Boolean(config.browserUse.profileId);
  updateTask(activeRun.id, task.id, {
    status: "pending",
    stage: hasProfile ? "Waiting for Browser Use profile approval" : "Waiting for Browser Use profile setup",
    result: `Selected DoorDash option: ${selected}. Profile approval required before cart building.`,
    constraints: {
      ...(task.constraints || {}),
      selectedDoorDashRestaurant: selected
    }
  });
  const reply = hasProfile
    ? `${selected} selected. Reply \`approve profile\` to let GOFER use your synced Browser Use profile to build the cart. I will stop before payment or order submission.`
    : `${selected} selected. To build the DoorDash cart, GOFER needs your synced Browser Use profile. Sync once, set \`BROWSER_USE_PROFILE_ID\`, restart GOFER, then reply \`approve profile\`. I will stop before payment or order submission.`;
  addChatMessage("assistant", reply, {
    runId: activeRun.id,
    taskId: task.id,
    action: hasProfile ? "doordash_option_selected_profile_requested" : "doordash_option_selected_profile_required",
    selected
  });
  emit("approval.option_selected", {
    runId: activeRun.id,
    taskId: task.id,
    selected,
    next: hasProfile ? "approve_profile" : "sync_browser_profile"
  });
  return reply;
}

function handleIrreversibleApproval({ message, activeRun, task }) {
  const isPurchase = task.type === "purchase";
  const reply = isPurchase
    ? "I captured your approval intent, but GOFER will not execute payment, checkout, delivery confirmation, or final order submission from this chat path. The prepared cart/details remain in the task artifact for review."
    : "I captured your approval intent, but GOFER will not submit the dispute or send the final message from this chat path. The prepared draft remains in the task artifact for review.";
  addChatMessage("assistant", reply, {
    runId: activeRun.id,
    taskId: task.id,
    action: isPurchase ? "payment_execution_blocked" : "submission_execution_blocked",
    userMessage: message
  });
  emit("approval.blocked", {
    runId: activeRun.id,
    taskId: task.id,
    reason: isPurchase ? "payment_execution_requires_explicit_adapter" : "submission_execution_requires_explicit_adapter"
  });
  return reply;
}

async function handleDoorDashCartApproval({ message, activeRun, task }) {
  const hasProfile = Boolean(config.browserUse.profileId);
  const profileApproved = /profile|cart|checkout|add|order|approve|proceed|continue|yes/i.test(message);
  const selected = task.constraints?.selectedDoorDashRestaurant || latestApprovalArtifact(task)?.recommendation || null;
  if (!hasProfile) {
    const reply = selected
      ? `${selected} is selected. To build the DoorDash cart, GOFER needs your synced Browser Use profile. Sync once, set \`BROWSER_USE_PROFILE_ID\`, restart GOFER, then reply \`approve profile\`.`
      : "I found food options first. To build the DoorDash cart, GOFER needs your synced Browser Use profile. Sync once, set `BROWSER_USE_PROFILE_ID`, restart GOFER, then reply `approve profile`.";
    addChatMessage("assistant", reply, {
      runId: activeRun.id,
      taskId: task.id,
      action: "doordash_cart_profile_required"
    });
    emit("auth.required", { runId: activeRun.id, taskId: task.id, reason: "doordash_cart_profile_required" });
    return reply;
  }
  if (!profileApproved) {
    const reply = "I found food options. Reply `approve profile` to use your synced Browser Use profile and build the cart. GOFER will still stop before payment or order submission.";
    addChatMessage("assistant", reply, {
      runId: activeRun.id,
      taskId: task.id,
      action: "doordash_cart_permission_requested"
    });
    return reply;
  }
  const memory = rememberBrowserProfileApproval({
    taskTitle: task.title,
    runId: activeRun.id,
    taskId: task.id
  });
  saveMemory({ content: memory.content }).catch((error) => {
    emit("memory.save_failed", { error: error.message, source: "browser_profile_permission" });
  });
  const followup = buildAuthenticatedFollowupTask(task, { blocker: "cart building requires authenticated DoorDash profile" });
  const reply = selected
    ? `Approved. I will use your synced Browser Use profile to build a DoorDash cart for ${selected} and stop before payment or order submission.`
    : "Approved. I will use your synced Browser Use profile to build the DoorDash cart and stop before payment or order submission.";
  addChatMessage("assistant", reply, {
    runId: activeRun.id,
    taskId: task.id,
    action: "doordash_cart_profile_accepted",
    followup
  });
  startManualRun(followup).catch((error) => {
    emit("run.error", { error: error.message });
  });
  return reply;
}

async function handleAuthChat({ message, activeRun, task, authHandoff }) {
  const hasProfile = Boolean(config.browserUse.profileId);
  const userApprovedProfile = isAffirmative(message) || /use.*profile|profile.*ok|approve.*profile|i synced|synced|signed in|done|rerun|try again/i.test(message);

  if (!hasProfile) {
    const reply = authHandoff.liveUrl
      ? "You only need to sync a Browser Use profile once. This running GOFER process does not currently see `BROWSER_USE_PROFILE_ID`, so it cannot use a synced profile yet. Complete OAuth in the debug browser if one is available, or set `BROWSER_USE_PROFILE_ID` in `.env` and restart GOFER once. After that, reply `approve profile` for this task."
      : "You only need to sync a Browser Use profile once. This running GOFER process does not currently see `BROWSER_USE_PROFILE_ID`, so set it in `.env` and restart GOFER once. After that, reply `approve profile` for this task.";
    addChatMessage("assistant", reply, {
      runId: activeRun.id,
      taskId: task.id,
      action: "auth_profile_required",
      liveUrl: authHandoff.liveUrl || null
    });
    emit("auth.required", { runId: activeRun.id, taskId: task.id, liveUrl: authHandoff.liveUrl || null });
    return reply;
  }

  if (!userApprovedProfile) {
    const reply = "A synced Browser Use profile is already configured. GOFER will not ask you to sync again. Reply `approve profile` to let GOFER use it for this task, or `no` to stop.";
    addChatMessage("assistant", reply, {
      runId: activeRun.id,
      taskId: task.id,
      action: "profile_permission_requested"
    });
    emit("profile.permission_requested", { runId: activeRun.id, taskId: task.id });
    return reply;
  }

  const memory = rememberBrowserProfileApproval({
    taskTitle: task.title,
    runId: activeRun.id,
    taskId: task.id
  });
  saveMemory({ content: memory.content }).catch((error) => {
    emit("memory.save_failed", { error: error.message, source: "browser_profile_permission" });
  });

  const followup = buildAuthenticatedFollowupTask(task, authHandoff);
  const reply = "Approved. I will use the synced Browser Use profile for this task and rerun the authenticated browser step. I will still stop before payment, final booking, account creation, or final submission.";
  addChatMessage("assistant", reply, {
    runId: activeRun.id,
    taskId: task.id,
    action: "profile_permission_accepted",
    followup
  });
  emit("profile.permission_accepted", { runId: activeRun.id, taskId: task.id, followup });
  startManualRun(followup).catch((error) => {
    emit("run.error", { error: error.message });
  });
  return reply;
}

function latestApprovalArtifact(task) {
  if (!task || !["pending", "running"].includes(task.status)) return null;
  const artifact = [...(task.artifacts || [])].reverse().find((item) => item.kind === "approval");
  if (!artifact) return null;
  const browserArtifact = [...(task.artifacts || [])].reverse().find((item) => item.kind === "browser" && item.output);
  const parsed = parseJsonMaybe(browserArtifact?.output);
  return {
    artifact,
    recommendation: parseRecommendation(artifact.detail) || parsed?.recommended_option || parsed?.recommended_candidate?.name || parsed?.recommended_candidate || null
  };
}

function latestAuthHandoff(task) {
  if (!task || !["pending", "running"].includes(task.status)) return null;
  for (const artifact of [...(task.artifacts || [])].reverse()) {
    const parsed = parseJsonMaybe(artifact.output);
    const liveUrl = artifact.liveUrl || artifact.live_url || null;
    if (artifact.actionRequired?.type === "auth") {
      return {
        artifact,
        liveUrl,
        message: artifact.actionRequired.message,
        blocker: artifact.actionRequired.blocker,
        parsed
      };
    }
    if (parsed?.auth_required === true || /oauth|login|sign in|authentication|browser use profile|persistent profile/i.test(`${parsed?.blocker || ""} ${parsed?.user_instruction || ""} ${artifact.detail || ""}`)) {
      return {
        artifact,
        liveUrl,
        message: parsed?.user_instruction || artifact.detail || "Authentication is required.",
        blocker: parsed?.blocker || null,
        parsed
      };
    }
  }
  return null;
}

function parseRecommendation(detail) {
  const match = String(detail || "").match(/Recommended:\s*([^.\n]+)/i);
  return match?.[1]?.trim() || null;
}

function selectCandidateFromMessage(task, message) {
  const text = message.toLowerCase();
  for (const artifact of task.artifacts || []) {
    const parsed = parseJsonMaybe(artifact.output);
    const candidates = [...(parsed?.candidates || []), ...(parsed?.options || [])];
    const match = candidates.find((candidate) => {
      const label = candidate?.name || candidate?.restaurant_name || candidate?.selected_item || candidate?.label;
      return label && text.includes(label.toLowerCase());
    });
    if (match) return match.name || match.restaurant_name || match.selected_item || match.label;
  }
  return null;
}

function buildApprovalAcceptedReply(task, selected) {
  if (task.type === "restaurant_reservation") {
    if (/phone fallback|call the restaurant|online availability not verified/i.test(`${task.result || ""} ${task.stage || ""}`)) {
      return `Approved. I am starting the phone fallback for ${selected}. I will only check availability and will not book or pay without another confirmation.`;
    }
    return `Proceeding with ${selected}. I am starting the next step now: verify availability and prepare the booking path.`;
  }
  if (task.type === "product_discovery") {
    return `Proceeding with ${selected}. I am starting the cart-prep step now and will stop before checkout, payment, or order submission.`;
  }
  return `Proceeding with ${selected}. I am starting the approved next step now and will stop before any irreversible action.`;
}

function buildFollowupTask(task, selected) {
  if (task.type === "restaurant_reservation") {
    if (/phone fallback|call the restaurant|online availability not verified/i.test(`${task.result || ""} ${task.stage || ""}`)) {
      return `Call ${selected} to check availability for this approved reservation request: ${task.title}. Only ask for the date, time, and party size the user explicitly requested. If any of those details are missing, ask the restaurant what information is needed and report back instead of inventing details. Do not finalize the booking, accept a deposit, or make payment without user confirmation.`;
    }
    return `Verify live availability and prepare booking for ${selected} for this request: ${task.title}. Do not finalize the booking or submit payment without approval.`;
  }
  if (task.type === "product_discovery") {
    if (/ubereats|uber\s+eats/i.test(task.title)) {
      return `Build a UberEats cart for ${selected} on ubereats for this approved request: ${task.title}. Stop before checkout, payment, or order submission.`;
    }
    if (/doordash/i.test(task.title)) {
      return `Build a DoorDash cart for ${selected} on doordash for this approved request: ${task.title}. Stop before checkout, payment, or order submission.`;
    }
    return `Build a cart for ${selected} for this approved shopping request: ${task.title}. Stop before checkout, payment, delivery confirmation, or final order submission.`;
  }
  return `Continue this approved GOFER task for ${selected}: ${task.title}. Stop before any irreversible action.`;
}

function buildAuthenticatedFollowupTask(task, authHandoff) {
  if (task.type === "browser_test" && /doordash/i.test(task.title)) {
    const selected = task.constraints?.selectedDoorDashRestaurant;
    return selected
      ? `Build a DoorDash cart for ${selected} using the approved synced Browser Use profile. Stop at cart or checkout review before payment or order submission.`
      : "Build a DoorDash cart using the approved synced Browser Use profile. Stop at cart or checkout review before payment or order submission.";
  }
  if (task.type === "purchase") {
    return `Continue authenticated checkout preparation for this task using the approved synced Browser Use profile: ${task.title}. Stop before payment or final order submission.`;
  }
  if (task.type === "billing_dispute") {
    return `Continue authenticated billing dispute preparation for this task using the approved synced Browser Use profile: ${task.title}. Stop before final dispute submission.`;
  }
  if (task.type === "restaurant_reservation") {
    return `Continue authenticated reservation availability check for this task using the approved synced Browser Use profile: ${task.title}. Stop before final booking, deposit, or payment.`;
  }
  return `Continue this authenticated GOFER browser task using the approved synced Browser Use profile: ${task.title}. Stop before any irreversible action. Prior blocker: ${authHandoff.blocker || authHandoff.message || "authentication required"}.`;
}

function isAffirmative(message) {
  return /\b(yes|yep|yeah|approve|approved|proceed|continue|go ahead|book it|confirm)\b/i.test(message);
}

function isNegative(message) {
  return /\b(no|stop|cancel|do not|don't|hold off|decline)\b/i.test(message);
}

function isRetry(message) {
  return /\b(retry|again|rerun|try again|run it again|restart)\b/i.test(message);
}

function isNewErrandRequest(message) {
  const text = message.trim();
  if (!text) return false;
  if (isAffirmative(text)) return false;
  if (/^(no|nope|stop|cancel|do not|don't|hold off|decline)\b[.! ]*$/i.test(text)) return false;
  return /\b(let'?s|please|can you|could you|find|book|order|buy|send|shop|look for|search for|get|schedule|call|email|draft|dispute|fill)\b/i.test(text);
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
      // Try the next candidate.
    }
  }
  return null;
}

async function staticFile(pathname, res) {
  const safePath = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function eventStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  send({ type: "connected", at: new Date().toISOString() });
  bus.on("event", send);

  req.on("close", () => {
    bus.off("event", send);
  });
}
