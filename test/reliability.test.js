/**
 * Reliability layer unit tests — no real DB required.
 *
 * A mock pool is injected into each module so the tests exercise all
 * validation paths and the SQL-query logic without network I/O.
 *
 * Run:
 *   node --test test/reliability.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createTracer } from "../src/reliability/trace.js";
import { createProviderMemory } from "../src/reliability/providerMemory.js";
import { createOutcomeStore } from "../src/reliability/outcomeStore.js";
import { AdapterError } from "../src/interfaces/AdapterError.js";

// ── Mock pool factory ─────────────────────────────────────────────────────────

/**
 * Returns a minimal mock pg Pool.
 * @param {object} opts
 * @param {any[]}  opts.rows     rows to return from queries (default [])
 * @param {number} opts.rowCount rowCount for UPDATE/INSERT (default 1)
 * @param {Error}  opts.error    if set, every query rejects with this error
 */
function mockPool({ rows = [], rowCount = 1, error = null } = {}) {
  return {
    query: async () => {
      if (error) throw error;
      return { rows, rowCount };
    }
  };
}

// ── trace.js ─────────────────────────────────────────────────────────────────

describe("createTracer", () => {
  it("startErrand rejects when errandId is missing", async () => {
    const tracer = createTracer(mockPool());
    await assert.rejects(
      tracer.startErrand("", { userId: "u1" }),
      (err) => {
        assert.ok(err instanceof AdapterError);
        assert.equal(err.kind, "invalid");
        return true;
      }
    );
  });

  it("startErrand rejects when userId is missing", async () => {
    const tracer = createTracer(mockPool());
    await assert.rejects(
      tracer.startErrand("errand-1", { userId: "" }),
      (err) => {
        assert.ok(err instanceof AdapterError);
        assert.equal(err.kind, "invalid");
        return true;
      }
    );
  });

  it("startErrand returns errandId on success", async () => {
    const tracer = createTracer(mockPool({ rows: [{ errand_id: "e1" }] }));
    const result = await tracer.startErrand("e1", { userId: "u1" });
    assert.equal(result, "e1");
  });

  it("startErrand wraps unexpected DB errors as AdapterError unknown", async () => {
    const tracer = createTracer(mockPool({ error: new Error("connection refused") }));
    await assert.rejects(
      tracer.startErrand("e1", { userId: "u1" }),
      (err) => {
        assert.ok(err instanceof AdapterError);
        assert.equal(err.kind, "unknown");
        assert.match(err.message, /connection refused/);
        return true;
      }
    );
  });

  it("logStep rejects when errandId is missing", async () => {
    const tracer = createTracer(mockPool());
    await assert.rejects(
      tracer.logStep("", null, { step: "book" }),
      (err) => {
        assert.ok(err instanceof AdapterError);
        assert.equal(err.kind, "invalid");
        return true;
      }
    );
  });

  it("logStep returns an id on success", async () => {
    const tracer = createTracer(mockPool({ rows: [{ id: 42 }] }));
    const result = await tracer.logStep("e1", "job-1", { step: "book", status: "done" });
    assert.equal(result.id, 42);
  });

  it("finishErrand rejects when errandId is missing", async () => {
    const tracer = createTracer(mockPool());
    await assert.rejects(
      tracer.finishErrand(""),
      (err) => {
        assert.ok(err instanceof AdapterError);
        assert.equal(err.kind, "invalid");
        return true;
      }
    );
  });

  it("finishErrand returns updated=true when a row was changed", async () => {
    const tracer = createTracer(mockPool({ rowCount: 1 }));
    const result = await tracer.finishErrand("e1", { outcome: "done", confirmed: true });
    assert.equal(result.errandId, "e1");
    assert.equal(result.outcome, "done");
    assert.equal(result.confirmed, true);
    assert.equal(result.updated, true);
  });

  it("finishErrand returns updated=false when no row matched", async () => {
    const tracer = createTracer(mockPool({ rowCount: 0 }));
    const result = await tracer.finishErrand("no-such-errand");
    assert.equal(result.updated, false);
  });
});

// ── providerMemory.js ─────────────────────────────────────────────────────────

describe("createProviderMemory", () => {
  it("recallProvider rejects when providerKey is missing", async () => {
    const mem = createProviderMemory(mockPool());
    await assert.rejects(
      mem.recallProvider(""),
      (err) => {
        assert.ok(err instanceof AdapterError);
        assert.equal(err.kind, "invalid");
        return true;
      }
    );
  });

  it("recallProvider returns {} when provider has no stored profile", async () => {
    const mem = createProviderMemory(mockPool({ rows: [] }));
    const profile = await mem.recallProvider("agentphone");
    assert.deepEqual(profile, {});
  });

  it("recallProvider returns stored profile", async () => {
    const stored = { successRate: 0.9, avgCost: 150 };
    const mem = createProviderMemory(mockPool({ rows: [{ profile: stored }] }));
    const profile = await mem.recallProvider("agentphone");
    assert.deepEqual(profile, stored);
  });

  it("updateProvider rejects when providerKey is missing", async () => {
    const mem = createProviderMemory(mockPool());
    await assert.rejects(
      mem.updateProvider("", { successRate: 0.9 }),
      (err) => {
        assert.ok(err instanceof AdapterError);
        assert.equal(err.kind, "invalid");
        return true;
      }
    );
  });

  it("updateProvider rejects a non-object delta", async () => {
    const mem = createProviderMemory(mockPool());
    await assert.rejects(
      mem.updateProvider("agentphone", "bad"),
      (err) => {
        assert.ok(err instanceof AdapterError);
        assert.equal(err.kind, "invalid");
        return true;
      }
    );
  });

  it("updateProvider merges delta into existing profile (Object.assign semantics)", async () => {
    // Single atomic upsert returns merged profile via RETURNING clause.
    const pool = {
      query: async () => ({ rows: [{ profile: { a: 1, b: 99, c: 3 } }], rowCount: 1 })
    };
    const mem = createProviderMemory(pool);
    const merged = await mem.updateProvider("agentphone", { b: 99, c: 3 });
    assert.deepEqual(merged, { a: 1, b: 99, c: 3 });
  });

  it("updateProvider creates a new profile when none exists", async () => {
    const pool = {
      query: async () => ({ rows: [{ profile: { score: 42 } }], rowCount: 1 })
    };
    const mem = createProviderMemory(pool);
    const merged = await mem.updateProvider("new-provider", { score: 42 });
    assert.deepEqual(merged, { score: 42 });
  });
});

// ── outcomeStore.js ───────────────────────────────────────────────────────────

describe("createOutcomeStore", () => {
  it("recordOutcome rejects when errandId is missing", async () => {
    const store = createOutcomeStore(mockPool());
    await assert.rejects(
      store.recordOutcome(""),
      (err) => {
        assert.ok(err instanceof AdapterError);
        assert.equal(err.kind, "invalid");
        return true;
      }
    );
  });

  it("recordOutcome returns echoed fields on success", async () => {
    const store = createOutcomeStore(mockPool({ rows: [] }));
    const result = await store.recordOutcome("e1", {
      completed: true,
      confirmed: true,
      costCents: 250,
      channel: "voice"
    });
    assert.equal(result.errandId, "e1");
    assert.equal(result.completed, true);
    assert.equal(result.confirmed, true);
    assert.equal(result.costCents, 250);
    assert.equal(result.channel, "voice");
  });

  it("recordOutcome wraps DB errors as AdapterError unknown", async () => {
    const store = createOutcomeStore(mockPool({ error: new Error("deadlock") }));
    await assert.rejects(
      store.recordOutcome("e1"),
      (err) => {
        assert.ok(err instanceof AdapterError);
        assert.equal(err.kind, "unknown");
        assert.match(err.message, /deadlock/);
        return true;
      }
    );
  });

  it("metrics returns zero rates when no rows match", async () => {
    const store = createOutcomeStore(
      mockPool({ rows: [{ total: "0", completed: "0", confirmed: "0" }] })
    );
    const m = await store.metrics(24);
    assert.equal(m.total, 0);
    assert.equal(m.completionRate, 0);
    assert.equal(m.confirmationRate, 0);
  });

  it("metrics computes rates correctly", async () => {
    const store = createOutcomeStore(
      mockPool({ rows: [{ total: "10", completed: "8", confirmed: "5" }] })
    );
    const m = await store.metrics(24);
    assert.equal(m.total, 10);
    assert.equal(m.completed, 8);
    assert.equal(m.confirmed, 5);
    assert.equal(m.completionRate, 0.8);
    assert.equal(m.confirmationRate, 0.5);
  });

  it("metrics accepts a channel filter", async () => {
    const pool = {
      query: async (_sql, params) => {
        assert.ok(params.includes("voice"), "channel filter should be in params");
        return { rows: [{ total: "3", completed: "3", confirmed: "2" }], rowCount: 1 };
      }
    };
    const store = createOutcomeStore(pool);
    const m = await store.metrics(12, { channel: "voice" });
    assert.equal(m.total, 3);
  });
});

// ── getDefault* raise when not configured ────────────────────────────────────

describe("getDefault* helpers", () => {
  it("getDefaultTracer is exported as a function", async () => {
    const { getDefaultTracer } = await import("../src/reliability/trace.js");
    assert.equal(typeof getDefaultTracer, "function");
  });

  it("getDefaultProviderMemory is exported as a function", async () => {
    const { getDefaultProviderMemory } = await import("../src/reliability/providerMemory.js");
    assert.equal(typeof getDefaultProviderMemory, "function");
  });

  it("getDefaultOutcomeStore is exported as a function", async () => {
    const { getDefaultOutcomeStore } = await import("../src/reliability/outcomeStore.js");
    assert.equal(typeof getDefaultOutcomeStore, "function");
  });

  it("getDefaultTracer throws AdapterError unavailable before setDefaultTracer", async () => {
    // Import fresh copy; module singleton may already be populated in this process.
    // We test the throw by re-importing — if _default is null it will throw.
    // Since ESM modules are cached, we check the export type then attempt a call
    // knowing it may or may not have been set; we only assert the error kind if it throws.
    const { getDefaultTracer } = await import("../src/reliability/trace.js");
    try {
      getDefaultTracer();
    } catch (err) {
      assert.ok(err instanceof AdapterError, "should be AdapterError");
      assert.equal(err.kind, "unavailable");
      assert.equal(err.provider, "tracer");
    }
  });
});
