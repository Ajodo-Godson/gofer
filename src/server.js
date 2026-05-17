import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import "./lib/env.js";
import { config, integrationStatus, setupChecklist } from "./lib/config.js";
import { getAgentSnapshots, startAgents, stopAgents } from "./agents/manager.js";
import { isBrowserUseDemoRunning, startBrowserUseDemo } from "./lib/browserUseDemo.js";
import { startDemoRun, startManualRun } from "./lib/orchestrator.js";
import { bus, emit, getState, loadSeedData } from "./lib/store.js";
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
