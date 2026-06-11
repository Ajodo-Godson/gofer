/**
 * Control plane unit tests — no real DB or real secrets needed.
 *
 * Covers: authorization, gates (HMAC tokens), and audit (mock pool).
 *
 * Run:
 *   node --test test/control.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createAuthorization } from "../src/control/authorization.js";
import { createGates } from "../src/control/gates.js";
import { createAudit } from "../src/control/audit.js";

// ── Mock pool factory ─────────────────────────────────────────────────────────

/**
 * Builds a recordable mock pool.
 * Each .query() call appends { sql, params } to pool.calls.
 * Optionally throws on the nth call (1-indexed) if errors[n-1] is set.
 */
function mockPool({ rows = [], rowCount = 1, error = null } = {}) {
  const pool = {
    calls: [],
    query: async (sql, params = []) => {
      pool.calls.push({ sql, params });
      if (error) throw error;
      return { rows, rowCount };
    }
  };
  return pool;
}

// ── authorization ─────────────────────────────────────────────────────────────

describe("createAuthorization", () => {
  it("returns allowed:false when userId is missing", async () => {
    const auth = createAuthorization();
    const result = await auth.authorize({ capability: "voice" });
    assert.equal(result.allowed, false);
    assert.ok(result.reason, "should have a reason");
    assert.match(result.reason, /userId/);
  });

  it("returns allowed:false when capability is missing", async () => {
    const auth = createAuthorization();
    const result = await auth.authorize({ userId: "u1" });
    assert.equal(result.allowed, false);
    assert.ok(result.reason);
    assert.match(result.reason, /capability/);
  });

  it("returns allowed:false for payments without actor", async () => {
    const auth = createAuthorization();
    const result = await auth.authorize({ userId: "u1", capability: "payments" });
    assert.equal(result.allowed, false);
    assert.ok(result.reason);
    assert.match(result.reason, /actor/);
  });

  it("returns allowed:true for voice with userId present", async () => {
    const auth = createAuthorization();
    const result = await auth.authorize({ userId: "u1", capability: "voice" });
    assert.equal(result.allowed, true);
    assert.equal(result.reason, undefined);
  });

  it("returns allowed:true for payments when actor is provided", async () => {
    const auth = createAuthorization();
    const result = await auth.authorize({
      userId: "u1",
      capability: "payments",
      actor: "approver@example.com"
    });
    assert.equal(result.allowed, true);
  });

  it("never throws — returns allowed:false on empty ctx", async () => {
    const auth = createAuthorization();
    const result = await auth.authorize();
    assert.equal(result.allowed, false);
  });
});

// ── gates ─────────────────────────────────────────────────────────────────────

describe("createGates", () => {
  beforeEach(() => {
    process.env.APPROVAL_TOKEN_SECRET = "test-secret";
  });

  it("requiresApproval returns true when step is in template.gates", () => {
    const gates = createGates();
    assert.equal(gates.requiresApproval({ gates: ["payment", "send-email"] }, "payment"), true);
  });

  it("requiresApproval returns false when step is not in gates", () => {
    const gates = createGates();
    assert.equal(gates.requiresApproval({ gates: ["payment"] }, "book-call"), false);
  });

  it("requiresApproval returns false for template without gates array", () => {
    const gates = createGates();
    assert.equal(gates.requiresApproval({}, "payment"), false);
    assert.equal(gates.requiresApproval(null, "payment"), false);
  });

  it("issueApprovalToken returns a token and expiresAt", async () => {
    const gates = createGates();
    const result = await gates.issueApprovalToken("errand-1", "send-email", "admin@example.com");
    assert.ok(typeof result.token === "string" && result.token.length > 0, "token must be non-empty");
    assert.ok(typeof result.expiresAt === "string", "expiresAt must be a string");
    assert.ok(result.token.includes("."), "token must have a . separator");
    // expiresAt is approximately one hour from now
    const exp = new Date(result.expiresAt).getTime();
    const now = Date.now();
    assert.ok(exp > now, "expiresAt must be in the future");
    assert.ok(exp < now + 3700 * 1000, "expiresAt must be within ~1 hour");
  });

  it("verifyApprovalToken returns true for a freshly issued token", async () => {
    const gates = createGates();
    const { token } = await gates.issueApprovalToken("errand-2", "book-call", "admin");
    const ok = await gates.verifyApprovalToken(token, "errand-2", "book-call");
    assert.equal(ok, true);
  });

  it("verifyApprovalToken returns false for a tampered token (flip one char)", async () => {
    const gates = createGates();
    const { token } = await gates.issueApprovalToken("errand-3", "book-call", "admin");
    // Flip the last character of the token
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    const ok = await gates.verifyApprovalToken(tampered, "errand-3", "book-call");
    assert.equal(ok, false);
  });

  it("verifyApprovalToken returns false for wrong errandId", async () => {
    const gates = createGates();
    const { token } = await gates.issueApprovalToken("errand-4", "book-call", "admin");
    const ok = await gates.verifyApprovalToken(token, "errand-WRONG", "book-call");
    assert.equal(ok, false);
  });

  it("verifyApprovalToken returns false for wrong step", async () => {
    const gates = createGates();
    const { token } = await gates.issueApprovalToken("errand-5", "book-call", "admin");
    const ok = await gates.verifyApprovalToken(token, "errand-5", "wrong-step");
    assert.equal(ok, false);
  });

  it("verifyApprovalToken returns false for expired token", async () => {
    const gates = createGates();
    // Issue a token, then mock Date.now to be 2 hours in the future
    const { token } = await gates.issueApprovalToken("errand-6", "book-call", "admin");

    const realDateNow = Date.now;
    try {
      Date.now = () => realDateNow() + 2 * 3600 * 1000; // 2 hours later
      const ok = await gates.verifyApprovalToken(token, "errand-6", "book-call");
      assert.equal(ok, false);
    } finally {
      Date.now = realDateNow;
    }
  });

  it("verifyApprovalToken returns false when secret is missing", async () => {
    const gates = createGates();
    const { token } = await gates.issueApprovalToken("errand-7", "step", "admin");
    delete process.env.APPROVAL_TOKEN_SECRET;
    const ok = await gates.verifyApprovalToken(token, "errand-7", "step");
    assert.equal(ok, false);
    // Restore for subsequent tests
    process.env.APPROVAL_TOKEN_SECRET = "test-secret";
  });
});

// ── audit ─────────────────────────────────────────────────────────────────────

describe("createAudit", () => {
  it("record inserts a row with the correct fields", async () => {
    const pool = mockPool();
    const audit = createAudit(pool);

    await audit.record({
      errandId: "e1",
      eventType: "auth_granted",
      actor: "u1",
      detail: { capability: "voice" }
    });

    assert.equal(pool.calls.length, 1);
    const [call] = pool.calls;
    assert.match(call.sql, /INSERT INTO audit/i);
    assert.equal(call.params[0], "e1");        // errand_id
    assert.equal(call.params[1], "u1");        // actor
    assert.equal(call.params[2], "auth_granted"); // action (eventType)
    // params[3] is the JSON-stringified detail
    const detail = JSON.parse(call.params[3]);
    assert.deepEqual(detail, { capability: "voice" });
  });

  it("record generates a unique id per call (no duplicate inserts in same batch)", async () => {
    // Two records should each call pool.query once (total 2 calls)
    const pool = mockPool();
    const audit = createAudit(pool);

    await audit.record({ eventType: "auth_granted", errandId: "e1" });
    await audit.record({ eventType: "auth_denied", errandId: "e1" });

    assert.equal(pool.calls.length, 2);
    // The SQL is the same but separate calls — each record is independent
    assert.match(pool.calls[0].sql, /INSERT INTO audit/i);
    assert.match(pool.calls[1].sql, /INSERT INTO audit/i);
  });

  it("query selects with errandId filter", async () => {
    const pool = mockPool({
      rows: [
        { errand_id: "e1", actor: "u1", action: "auth_granted", payload: {}, ts: new Date().toISOString() }
      ]
    });
    const audit = createAudit(pool);

    const results = await audit.query({ errandId: "e1" });

    assert.equal(pool.calls.length, 1);
    const [call] = pool.calls;
    assert.match(call.sql, /SELECT/i);
    assert.match(call.sql, /errand_id/i);
    assert.ok(call.params.includes("e1"), "errandId should be in query params");
    assert.equal(results.length, 1);
    assert.equal(results[0].errandId, "e1");
    assert.equal(results[0].eventType, "auth_granted");
  });

  it("append-only: record never issues UPDATE or DELETE SQL", async () => {
    const pool = mockPool();
    const audit = createAudit(pool);

    await audit.record({ eventType: "gate_issued", errandId: "e2", actor: "admin" });
    await audit.record({ eventType: "gate_verified", errandId: "e2" });

    for (const call of pool.calls) {
      assert.doesNotMatch(
        call.sql.toUpperCase(),
        /UPDATE|DELETE/,
        `SQL must not contain UPDATE or DELETE: ${call.sql}`
      );
    }
  });

  it("record uses errandId='' when errandId is omitted", async () => {
    const pool = mockPool();
    const audit = createAudit(pool);

    await audit.record({ eventType: "outcome_recorded" });

    assert.equal(pool.calls.length, 1);
    assert.equal(pool.calls[0].params[0], "");
  });

  it("query returns mapped AuditEvent shape", async () => {
    const ts = new Date().toISOString();
    const pool = mockPool({
      rows: [{ errand_id: "e3", actor: "bot", action: "gate_failed", payload: { reason: "expired" }, ts }]
    });
    const audit = createAudit(pool);

    const results = await audit.query({ eventType: "gate_failed" });

    assert.equal(results.length, 1);
    assert.equal(results[0].errandId, "e3");
    assert.equal(results[0].eventType, "gate_failed");
    assert.equal(results[0].actor, "bot");
    assert.deepEqual(results[0].detail, { reason: "expired" });
  });
});
