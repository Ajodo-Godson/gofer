// Smoke test for verifyAgentMailSignature. Exercises:
//   1. A fresh, correctly-signed payload  -> ok: true
//   2. A tampered body                    -> ok: false (signature mismatch)
//   3. An old timestamp                   -> ok: false (timestamp window)
//   4. Missing svix-* headers             -> ok: false (missing headers)
//   5. Multiple signatures, one valid     -> ok: true
// Run with: node scripts/verify-agentmail-signature.mjs

import { createHmac } from "node:crypto";

// Override the secret before importing the module so the runtime config
// picks it up. This file is not imported by anything else.
process.env.AGENTMAIL_WEBHOOK_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

const { verifyAgentMailSignature } = await import("../src/integrations/agentmail.js");

const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
const secretBytes = Buffer.from(secret.slice("whsec_".length), "base64");

function sign({ id, timestamp, body }) {
  const signed = `${id}.${timestamp}.${body}`;
  return `v1,${createHmac("sha256", secretBytes).update(signed).digest("base64")}`;
}

const cases = [];

const now = Math.floor(Date.now() / 1000).toString();
const id = "msg_test_1";
const body = JSON.stringify({ event_type: "message.received", message: { from: "a@b.com" } });

// 1. Valid
cases.push({
  name: "valid signature",
  expected: true,
  body,
  headers: {
    "svix-id": id,
    "svix-timestamp": now,
    "svix-signature": sign({ id, timestamp: now, body })
  }
});

// 2. Tampered body
cases.push({
  name: "tampered body",
  expected: false,
  body: body + "X",
  headers: {
    "svix-id": id,
    "svix-timestamp": now,
    "svix-signature": sign({ id, timestamp: now, body })
  }
});

// 3. Old timestamp
const old = (Math.floor(Date.now() / 1000) - 60 * 60).toString();
cases.push({
  name: "old timestamp",
  expected: false,
  body,
  headers: {
    "svix-id": id,
    "svix-timestamp": old,
    "svix-signature": sign({ id, timestamp: old, body })
  }
});

// 4. Missing headers
cases.push({
  name: "missing headers",
  expected: false,
  body,
  headers: {}
});

// 5. Multiple sigs, one valid
const otherSig = "v1,bm9pc2U=";
cases.push({
  name: "multiple sigs, one valid",
  expected: true,
  body,
  headers: {
    "svix-id": id,
    "svix-timestamp": now,
    "svix-signature": `${otherSig} ${sign({ id, timestamp: now, body })}`
  }
});

let failed = 0;
for (const c of cases) {
  const result = verifyAgentMailSignature(Buffer.from(c.body, "utf8"), c.headers);
  const ok = result.ok === c.expected;
  console.log(`${ok ? "OK  " : "FAIL"}  ${c.name}  ->  ${JSON.stringify(result)}`);
  if (!ok) failed += 1;
}
process.exit(failed === 0 ? 0 : 1);
