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
import { addChatMessage, bus, emit, getState, loadSeedData, rememberBrowserProfileApproval, replaceSourceTasks } from "./lib/store.js";
import { appointmentVoiceReply, summarizeCallState } from "./lib/voiceController.js";

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
  emit("agentphone.webhook", {
    event: body.event,
    channel: body.channel,
    agentId: body.agentId,
    direction: body.data?.direction,
    from: body.data?.from,
    message: body.data?.message || null,
    call: summarizeCallState(body)
  });

  if (body.channel === "voice" || body.event?.includes("voice") || body.event?.includes("call")) {
    return json(res, appointmentVoiceReply(body));
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

function verifyAgentPhoneSignature(rawBody, signature) {
  if (!signature || typeof signature !== "string") return false;
  const expected = `sha256=${createHmac("sha256", config.agentPhone.webhookSecret)
    .update(rawBody)
    .digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
}

async function handleUserChat(message) {
  addChatMessage("user", message);
  const state = getState();
  const activeRun = state.runs[0];
  const task = activeRun?.tasks?.[0];
  const approval = latestApprovalArtifact(task);
  const authHandoff = latestAuthHandoff(task);

  if (!task || (!approval && !authHandoff)) {
    const reply = "I do not have a pending approval gate right now. Dispatch an errand first, then reply here to approve, change, or continue it.";
    addChatMessage("assistant", reply);
    return reply;
  }

  if (isNegative(message)) {
    const reply = "Got it. I will not proceed. Tell me what to change, or dispatch a new errand.";
    addChatMessage("assistant", reply, { runId: activeRun.id, taskId: task.id, action: "approval_declined" });
    emit("approval.declined", { runId: activeRun.id, taskId: task.id, message });
    return reply;
  }

  if (authHandoff) {
    return handleAuthChat({ message, activeRun, task, authHandoff });
  }

  const selected = selectCandidateFromMessage(task, message);
  if (isAffirmative(message) || selected) {
    const restaurant = selected || approval.recommendation || "the recommended option";
    const followup = buildFollowupTask(task, restaurant);
    const reply = `Proceeding with ${restaurant}. I am starting the next step now: verify availability and prepare the booking path.`;
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

  const reply = "I found a pending approval gate, but I could not tell which option you want. Reply with the restaurant name, or say yes to approve the recommended option.";
  addChatMessage("assistant", reply, { runId: activeRun.id, taskId: task.id, action: "approval_clarify" });
  return reply;
}

async function handleAuthChat({ message, activeRun, task, authHandoff }) {
  const hasProfile = Boolean(config.browserUse.profileId);
  const userApprovedProfile = isAffirmative(message) || /use.*profile|profile.*ok|approve.*profile|i synced|synced|signed in|done|rerun|try again/i.test(message);

  if (!hasProfile) {
    const reply = authHandoff.liveUrl
      ? "This workflow needs authentication. Open the debug browser session and complete the login/OAuth step there. For reliable reruns, sync that browser state into a Browser Use profile, set `BROWSER_USE_PROFILE_ID`, restart GOFER, then reply `approve profile`. GOFER will store that task-specific permission in memory before using it."
      : "This workflow needs a synced Browser Use profile. Sync/login through Browser Use, set `BROWSER_USE_PROFILE_ID`, restart GOFER, then reply `approve profile`. GOFER will store that task-specific permission in memory before using it.";
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
    const reply = "This step can use your synced Browser Use profile to continue through the login/OAuth boundary. Reply `approve profile` to allow GOFER to use that profile for this task, or `no` to stop.";
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
  if (!task) return null;
  const artifact = [...(task.artifacts || [])].reverse().find((item) => item.kind === "approval");
  if (!artifact) return null;
  return {
    artifact,
    recommendation: parseRecommendation(artifact.detail)
  };
}

function latestAuthHandoff(task) {
  if (!task) return null;
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
    const candidates = parsed?.candidates || [];
    const match = candidates.find((candidate) => candidate?.name && text.includes(candidate.name.toLowerCase()));
    if (match) return match.name;
  }
  return null;
}

function buildFollowupTask(task, selected) {
  if (task.type === "restaurant_reservation") {
    return `Verify live availability and prepare booking for ${selected} for this request: ${task.title}. Do not finalize the booking or submit payment without approval.`;
  }
  return `Continue this approved GOFER task for ${selected}: ${task.title}. Stop before any irreversible action.`;
}

function buildAuthenticatedFollowupTask(task, authHandoff) {
  if (task.type === "browser_test" && /doordash/i.test(task.title)) {
    return "Build a DoorDash cart using the approved synced Browser Use profile. Stop at cart or checkout review before payment or order submission.";
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
