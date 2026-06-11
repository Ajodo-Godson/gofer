/**
 * Tests for the owned Twilio VoiceCaller adapter.
 *
 * All tests run in simulation mode (no TWILIO_ACCOUNT_SID or
 * TWILIO_AUTH_TOKEN set) so no real Twilio API calls are made.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { AdapterError } from "../src/interfaces/AdapterError.js";
import { VoiceCaller } from "../src/interfaces/VoiceCaller.js";

const VALID_STATUSES = ["queued", "in_progress", "completed", "failed"];
const VALID_OUTCOMES = ["completed", "failed", "no_answer", "voicemail"];

// ---------------------------------------------------------------------------
// Factory and instance type
// ---------------------------------------------------------------------------

test("twilio adapter: createVoiceCaller returns a VoiceCaller subclass instance", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/twilio.js");
  assert.equal(typeof createVoiceCaller, "function");
  const caller = await createVoiceCaller();
  assert.ok(caller instanceof VoiceCaller, "should be a VoiceCaller instance");
});

// ---------------------------------------------------------------------------
// call() — simulation mode
// ---------------------------------------------------------------------------

test("twilio adapter: call() in simulation mode returns { callId, status }", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/twilio.js");
  const caller = await createVoiceCaller();
  const handle = await caller.call({
    toNumber: "+15551234567",
    objective: "Book appointment",
    errandId: "e1"
  });
  assert.ok(typeof handle.callId === "string" && handle.callId.length > 0, "callId must be a non-empty string");
  assert.ok(VALID_STATUSES.includes(handle.status), `status must be one of ${VALID_STATUSES.join(", ")}`);
});

test("twilio adapter: call() in simulation mode callId starts with 'sim-'", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/twilio.js");
  const caller = await createVoiceCaller();
  const handle = await caller.call({
    toNumber: "+15551234567",
    objective: "Book appointment",
    errandId: "e1"
  });
  assert.ok(handle.callId.startsWith("sim-"), `callId should start with 'sim-' in simulation mode, got: ${handle.callId}`);
});

// ---------------------------------------------------------------------------
// call() — validation errors
// ---------------------------------------------------------------------------

test("twilio adapter: call() throws AdapterError('invalid') when toNumber is missing", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/twilio.js");
  const caller = await createVoiceCaller();
  await assert.rejects(
    caller.call({ objective: "Book appointment", errandId: "e1" }),
    (error) => {
      assert.ok(error instanceof AdapterError, "should throw AdapterError");
      assert.equal(error.kind, "invalid");
      assert.equal(error.provider, "twilio");
      return true;
    }
  );
});

test("twilio adapter: call() throws AdapterError('invalid') when objective is missing", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/twilio.js");
  const caller = await createVoiceCaller();
  await assert.rejects(
    caller.call({ toNumber: "+15551234567", errandId: "e1" }),
    (error) => {
      assert.ok(error instanceof AdapterError, "should throw AdapterError");
      assert.equal(error.kind, "invalid");
      assert.equal(error.provider, "twilio");
      return true;
    }
  );
});

test("twilio adapter: call() throws AdapterError('invalid') when toNumber is not E.164 format", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/twilio.js");
  const caller = await createVoiceCaller();
  await assert.rejects(
    caller.call({ toNumber: "5551234567", objective: "Book appointment", errandId: "e1" }),
    (error) => {
      assert.ok(error instanceof AdapterError, "should throw AdapterError");
      assert.equal(error.kind, "invalid");
      assert.equal(error.provider, "twilio");
      return true;
    }
  );
});

test("twilio adapter: call() throws AdapterError('invalid') for E.164 missing + prefix", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/twilio.js");
  const caller = await createVoiceCaller();
  await assert.rejects(
    caller.call({ toNumber: "15551234567", objective: "Book appointment", errandId: "e1" }),
    (error) => {
      assert.ok(error instanceof AdapterError, "should throw AdapterError");
      assert.equal(error.kind, "invalid");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// result() — simulation mode
// ---------------------------------------------------------------------------

test("twilio adapter: result() in simulation mode returns { callId, outcome, transcript }", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/twilio.js");
  const caller = await createVoiceCaller();
  const result = await caller.result("sim-123");
  assert.equal(result.callId, "sim-123");
  assert.ok(VALID_OUTCOMES.includes(result.outcome), `outcome must be one of ${VALID_OUTCOMES.join(", ")}`);
  assert.equal(result.outcome, "completed");
  assert.equal(typeof result.transcript, "string");
  assert.ok(result.transcript.length > 0, "transcript must be a non-empty string");
});

test("twilio adapter: result() in simulation mode returns structured: null", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/twilio.js");
  const caller = await createVoiceCaller();
  const result = await caller.result("sim-456");
  assert.equal(result.structured, null);
});

// ---------------------------------------------------------------------------
// result() — validation errors
// ---------------------------------------------------------------------------

test("twilio adapter: result() throws AdapterError('invalid') when callId is missing", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/twilio.js");
  const caller = await createVoiceCaller();
  await assert.rejects(
    caller.result(""),
    (error) => {
      assert.ok(error instanceof AdapterError, "should throw AdapterError");
      assert.equal(error.kind, "invalid");
      assert.equal(error.provider, "twilio");
      return true;
    }
  );
});

test("twilio adapter: result() throws AdapterError('invalid') when callId is undefined", async () => {
  const { createVoiceCaller } = await import("../src/adapters/voice/twilio.js");
  const caller = await createVoiceCaller();
  await assert.rejects(
    caller.result(undefined),
    (error) => {
      assert.ok(error instanceof AdapterError, "should throw AdapterError");
      assert.equal(error.kind, "invalid");
      return true;
    }
  );
});
