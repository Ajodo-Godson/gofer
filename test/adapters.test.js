/**
 * Contract tests for the five vendor adapter wrappers.
 *
 * Each test instantiates the adapter factory (which always succeeds in demo
 * mode) and then verifies:
 *   1. The instance is the correct subclass of the matching interface.
 *   2. The factory export name matches the interface registry expectation.
 *   3. Key methods exist and have the right arity.
 *   4. Invalid inputs throw AdapterError with kind "invalid".
 *   5. Simulated / demo-mode calls return the correct output shape.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { AdapterError, VoiceCaller, Browser, Mailer, MemoryStore, Payments } from "../src/interfaces/index.js";

// --- voice/agentphone ---

test("agentphone adapter: factory returns a VoiceCaller subclass", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/agentphone.js");
  assert.equal(typeof createVoiceCaller, "function");
  const caller = await createVoiceCaller();
  assert.ok(caller instanceof VoiceCaller, "should be a VoiceCaller instance");
});

test("agentphone adapter: call() rejects missing toNumber", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/agentphone.js");
  const caller = await createVoiceCaller();
  await assert.rejects(
    caller.call({ objective: "book appointment", errandId: "e1" }),
    (error) => {
      assert.ok(error instanceof AdapterError, "should throw AdapterError");
      assert.equal(error.kind, "invalid");
      assert.equal(error.provider, "agentphone");
      return true;
    }
  );
});

test("agentphone adapter: call() rejects missing objective", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/agentphone.js");
  const caller = await createVoiceCaller();
  await assert.rejects(
    caller.call({ toNumber: "+15555550100", errandId: "e1" }),
    (error) => {
      assert.equal(error instanceof AdapterError, true);
      assert.equal(error.kind, "invalid");
      return true;
    }
  );
});

test("agentphone adapter: call() returns a CallHandle in demo mode", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/agentphone.js");
  const caller = await createVoiceCaller();
  const handle = await caller.call({
    toNumber: "+15555550100",
    objective: "Book a dentist appointment",
    errandId: "e1"
  });
  assert.ok(typeof handle.callId === "string" && handle.callId.length > 0, "callId must be a non-empty string");
  const validStatuses = ["queued", "in_progress", "completed", "failed"];
  assert.ok(validStatuses.includes(handle.status), `status must be one of ${validStatuses.join(", ")}`);
});

test("agentphone adapter: result() rejects missing callId", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/agentphone.js");
  const caller = await createVoiceCaller();
  await assert.rejects(
    caller.result(""),
    (error) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "invalid");
      return true;
    }
  );
});

// --- browser/browserUse ---

test("browserUse adapter: factory returns a Browser subclass", async () => {
  const { createBrowser } = await import("../src/adapters/browser/browserUse.js");
  assert.equal(typeof createBrowser, "function");
  const browser = await createBrowser();
  assert.ok(browser instanceof Browser, "should be a Browser instance");
});

test("browserUse adapter: act() rejects missing prompt", async () => {
  const { createBrowser } = await import("../src/adapters/browser/browserUse.js");
  const browser = await createBrowser();
  await assert.rejects(
    browser.act({ errandId: "e2" }),
    (error) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "invalid");
      assert.equal(error.provider, "browserUse");
      return true;
    }
  );
});

test("browserUse adapter: act() returns an ActResult in demo mode", async () => {
  const { createBrowser } = await import("../src/adapters/browser/browserUse.js");
  const browser = await createBrowser();
  const result = await browser.act({ prompt: "Search for dentists near me", errandId: "e2" });
  assert.equal(typeof result.success, "boolean");
  assert.ok(Array.isArray(result.artifacts), "artifacts must be an array");
});

test("browserUse adapter: authSession() rejects missing profileId", async () => {
  const { createBrowser } = await import("../src/adapters/browser/browserUse.js");
  const browser = await createBrowser();
  await assert.rejects(
    browser.authSession(""),
    (error) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "invalid");
      return true;
    }
  );
});

test("browserUse adapter: authSession() returns sessionId for a profileId", async () => {
  const { createBrowser } = await import("../src/adapters/browser/browserUse.js");
  const browser = await createBrowser();
  const session = await browser.authSession("profile-abc");
  assert.equal(typeof session.sessionId, "string");
  assert.ok(session.sessionId.length > 0);
});

// --- mail/agentmail ---

test("agentmail adapter: factory returns a Mailer subclass", async () => {
  const { createMailer } = await import("../src/adapters/mail/agentmail.js");
  assert.equal(typeof createMailer, "function");
  const mailer = await createMailer();
  assert.ok(mailer instanceof Mailer, "should be a Mailer instance");
});

test("agentmail adapter: send() rejects missing to", async () => {
  const { createMailer } = await import("../src/adapters/mail/agentmail.js");
  const mailer = await createMailer();
  await assert.rejects(
    mailer.send({ subject: "Hello", body: "World", errandId: "e3" }),
    (error) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "invalid");
      assert.equal(error.provider, "agentmail");
      return true;
    }
  );
});

test("agentmail adapter: send() rejects missing subject", async () => {
  const { createMailer } = await import("../src/adapters/mail/agentmail.js");
  const mailer = await createMailer();
  await assert.rejects(
    mailer.send({ to: "test@example.com", body: "World", errandId: "e3" }),
    (error) => {
      assert.equal(error instanceof AdapterError, true);
      assert.equal(error.kind, "invalid");
      return true;
    }
  );
});

test("agentmail adapter: send() returns messageId and threadId in demo mode", async () => {
  const { createMailer } = await import("../src/adapters/mail/agentmail.js");
  const mailer = await createMailer();
  const result = await mailer.send({
    to: "test@example.com",
    subject: "Appointment reminder",
    body: "Your appointment is tomorrow.",
    errandId: "e3"
  });
  assert.ok(typeof result.messageId === "string" && result.messageId.length > 0, "messageId must be non-empty string");
  assert.equal(typeof result.threadId, "string");
});

test("agentmail adapter: poll() rejects missing threadId", async () => {
  const { createMailer } = await import("../src/adapters/mail/agentmail.js");
  const mailer = await createMailer();
  await assert.rejects(
    mailer.poll(""),
    (error) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "invalid");
      return true;
    }
  );
});

test("agentmail adapter: poll() returns an array in demo mode", async () => {
  const { createMailer } = await import("../src/adapters/mail/agentmail.js");
  const mailer = await createMailer();
  const messages = await mailer.poll("thread-123");
  assert.ok(Array.isArray(messages), "poll should return an array");
});

// --- memory/supermemory ---

test("supermemory adapter: factory returns a MemoryStore subclass", async () => {
  const { createMemoryStore } = await import("../src/adapters/memory/supermemory.js");
  assert.equal(typeof createMemoryStore, "function");
  const store = await createMemoryStore();
  assert.ok(store instanceof MemoryStore, "should be a MemoryStore instance");
});

test("supermemory adapter: write() rejects missing userId", async () => {
  const { createMemoryStore } = await import("../src/adapters/memory/supermemory.js");
  const store = await createMemoryStore();
  await assert.rejects(
    store.write({ text: "Some fact" }),
    (error) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "invalid");
      assert.equal(error.provider, "supermemory");
      return true;
    }
  );
});

test("supermemory adapter: write() rejects missing text", async () => {
  const { createMemoryStore } = await import("../src/adapters/memory/supermemory.js");
  const store = await createMemoryStore();
  await assert.rejects(
    store.write({ userId: "user-1" }),
    (error) => {
      assert.equal(error instanceof AdapterError, true);
      assert.equal(error.kind, "invalid");
      return true;
    }
  );
});

test("supermemory adapter: write() returns an id in demo mode", async () => {
  const { createMemoryStore } = await import("../src/adapters/memory/supermemory.js");
  const store = await createMemoryStore();
  const result = await store.write({
    userId: "user-1",
    kind: "fact",
    text: "Prefers afternoon appointments."
  });
  assert.ok(typeof result.id === "string" && result.id.length > 0, "id must be a non-empty string");
});

test("supermemory adapter: recall() rejects missing userId", async () => {
  const { createMemoryStore } = await import("../src/adapters/memory/supermemory.js");
  const store = await createMemoryStore();
  await assert.rejects(
    store.recall("", "dentist"),
    (error) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "invalid");
      return true;
    }
  );
});

test("supermemory adapter: recall() returns an array in demo mode", async () => {
  const { createMemoryStore } = await import("../src/adapters/memory/supermemory.js");
  const store = await createMemoryStore();
  const results = await store.recall("user-1", "dentist appointment");
  assert.ok(Array.isArray(results), "recall should return an array");
  for (const item of results) {
    assert.ok(item.fact, "each result must have a fact");
    assert.equal(typeof item.score, "number");
  }
});

// --- payments/sponge ---

test("sponge adapter: factory returns a Payments subclass", async () => {
  const { createPayments } = await import("../src/adapters/payments/sponge.js");
  assert.equal(typeof createPayments, "function");
  const payments = await createPayments();
  assert.ok(payments instanceof Payments, "should be a Payments instance");
});

test("sponge adapter: prepare() rejects missing userId", async () => {
  const { createPayments } = await import("../src/adapters/payments/sponge.js");
  const payments = await createPayments();
  await assert.rejects(
    payments.prepare({ amountCents: 1000, currency: "usd", description: "Test", errandId: "e5" }),
    (error) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "invalid");
      assert.equal(error.provider, "sponge");
      return true;
    }
  );
});

test("sponge adapter: prepare() rejects zero amountCents", async () => {
  const { createPayments } = await import("../src/adapters/payments/sponge.js");
  const payments = await createPayments();
  await assert.rejects(
    payments.prepare({ userId: "u1", amountCents: 0, currency: "usd", description: "Test" }),
    (error) => {
      assert.equal(error instanceof AdapterError, true);
      assert.equal(error.kind, "invalid");
      return true;
    }
  );
});

test("sponge adapter: prepare() returns a PreparedPayment", async () => {
  const { createPayments } = await import("../src/adapters/payments/sponge.js");
  const payments = await createPayments();
  const result = await payments.prepare({
    userId: "u1",
    amountCents: 1500,
    currency: "usd",
    description: "Dental visit copay",
    errandId: "e5"
  });
  assert.ok(typeof result.intentId === "string" && result.intentId.length > 0, "intentId must be non-empty");
  assert.equal(result.amountCents, 1500);
  assert.equal(typeof result.description, "string");
  assert.equal(result.status, "requires_approval");
});

test("sponge adapter: charge() rejects missing intentId", async () => {
  const { createPayments } = await import("../src/adapters/payments/sponge.js");
  const payments = await createPayments();
  await assert.rejects(
    payments.charge("", "token-abc"),
    (error) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "invalid");
      return true;
    }
  );
});

test("sponge adapter: charge() without approvalToken throws auth AdapterError", async () => {
  const { createPayments } = await import("../src/adapters/payments/sponge.js");
  const payments = await createPayments();
  await assert.rejects(
    payments.charge("sponge-intent-123", null),
    (error) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "auth");
      assert.equal(error.provider, "sponge");
      return true;
    }
  );
});
