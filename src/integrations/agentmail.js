import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../lib/config.js";

const BASE_URL = "https://api.agentmail.to/v0";

// Tolerate 5 minutes of clock skew between AgentMail and us. Anything older
// than this is rejected to prevent replay attacks per the Svix spec.
const SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export async function sendEmail({ to, subject, text }) {
  if (!config.demo.allowRealEmailSend || !config.agentMail.apiKey || !config.agentMail.from) {
    await wait(300);
    return {
      mode: "simulated",
      provider: "AgentMail",
      to,
      subject,
      text
    };
  }

  const inboxId = config.agentMail.inboxId || config.agentMail.from;
  const response = await fetch(`${BASE_URL}/inboxes/${encodeURIComponent(inboxId)}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.agentMail.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      to,
      subject,
      text,
      html: `<p>${escapeHtml(text).replaceAll("\n", "<br>")}</p>`
    })
  });

  if (!response.ok) {
    throw new Error(`AgentMail send failed: ${response.status} ${await response.text()}`);
  }

  return {
    mode: "real",
    provider: "AgentMail",
    data: await response.json()
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Verifies an inbound AgentMail webhook signature using the Svix scheme.
// AgentMail uses Svix to deliver webhooks; the signing secret starts with
// `whsec_` and the headers follow svix-id / svix-timestamp / svix-signature.
//
// Reference: https://docs.svix.com/receiving/verifying-payloads/how-manual
//
// Returns { ok: true } on success or { ok: false, reason } on failure. Never
// throws; callers can map the reason to a 400/401 response. We deliberately
// return a generic reason on signature mismatch to avoid leaking which check
// failed.
export function verifyAgentMailSignature(rawBody, headers) {
  const secret = config.agentMail.webhookSecret;
  if (!secret) {
    return { ok: false, reason: "Webhook secret not configured" };
  }
  if (!secret.startsWith("whsec_")) {
    return { ok: false, reason: "Webhook secret must start with whsec_" };
  }

  const id = headerValue(headers, "svix-id");
  const timestamp = headerValue(headers, "svix-timestamp");
  const signatureHeader = headerValue(headers, "svix-signature");
  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, reason: "Missing svix-* headers" };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, reason: "Invalid svix-timestamp" };
  }
  const skew = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
  if (skew > SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: "Timestamp outside tolerance window" };
  }

  let secretBytes;
  try {
    secretBytes = Buffer.from(secret.slice("whsec_".length), "base64");
  } catch {
    return { ok: false, reason: "Webhook secret is not valid base64" };
  }

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "", "utf8");
  const signedContent = Buffer.concat([
    Buffer.from(`${id}.${timestamp}.`, "utf8"),
    bodyBuffer
  ]);
  const expected = createHmac("sha256", secretBytes).update(signedContent).digest("base64");
  const expectedBuffer = Buffer.from(expected, "utf8");

  // svix-signature can hold multiple space-delimited entries like
  // "v1,<sig> v1,<sig2>"; any matching v1 entry counts as verified.
  const candidates = signatureHeader.split(" ");
  for (const candidate of candidates) {
    const [version, value] = candidate.split(",");
    if (version !== "v1" || !value) continue;
    const candidateBuffer = Buffer.from(value, "utf8");
    if (candidateBuffer.length !== expectedBuffer.length) continue;
    if (timingSafeEqual(candidateBuffer, expectedBuffer)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "Signature mismatch" };
}

// Normalizes the AgentMail inbound webhook payload into the smallest set of
// fields the rest of GOFER actually uses. Returns null when the payload is
// not a recognized inbound message event.
//
// Reference: https://docs.agentmail.to/api-reference/webhooks/events/message-received
export function parseInboundEmailEvent(payload) {
  if (!payload || typeof payload !== "object") return null;
  const eventType = payload.event_type || payload.eventType;
  if (typeof eventType !== "string" || !eventType.startsWith("message.received")) return null;

  const message = payload.message || {};
  const thread = payload.thread || {};
  return {
    eventType,
    eventId: payload.event_id || payload.eventId || null,
    inboxId: message.inbox_id || message.inboxId || null,
    threadId: message.thread_id || message.threadId || thread.thread_id || thread.threadId || null,
    messageId: message.message_id || message.messageId || null,
    inReplyTo: message.in_reply_to || message.inReplyTo || null,
    from: message.from || null,
    to: Array.isArray(message.to) ? message.to : [],
    subject: message.subject || thread.subject || null,
    preview: message.preview || thread.preview || null,
    text: message.text || message.extracted_text || null,
    receivedAt: message.timestamp || message.created_at || null
  };
}

function headerValue(headers, name) {
  if (!headers) return null;
  const direct = headers[name];
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct)) return direct[0] || null;
  // Node lowercases incoming headers, but be defensive for the case where
  // a caller forwards a Headers-like object with mixed case.
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return value[0] || null;
    }
  }
  return null;
}
