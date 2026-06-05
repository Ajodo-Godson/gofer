/**
 * pgvector adapter tests
 *
 * Unit tests run always (no external dependencies).
 * Integration tests are skipped unless both env vars are set:
 *
 *   DATABASE_URL=postgresql://localhost:5432/gofer
 *   OPENAI_API_KEY=sk-...
 *
 * Quick setup with Docker:
 *
 *   docker run -d --name gofer-pg \
 *     -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=gofer \
 *     -p 5432:5432 \
 *     pgvector/pgvector:pg16
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gofer \
 *   OPENAI_API_KEY=sk-... \
 *   node --test test/pgvector.test.js
 *
 * The adapter auto-creates the gofer_memories table and the vector extension
 * on first connection, so no migration step is needed.
 *
 * Integration tests namespace all rows under a random userId and delete them
 * in after() so they leave the database clean.
 */

import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMemoryStore } from "../src/adapters/memory/pgvector.js";
import { AdapterError } from "../src/interfaces/AdapterError.js";
import { MemoryStore } from "../src/interfaces/MemoryStore.js";
import { config } from "../src/lib/config.js";

// ── Unit tests (no DB, no OpenAI) ────────────────────────────────────────────

test("pgvector adapter is unavailable without database configuration", async () => {
  const orig = { db: config.pgvector.databaseUrl, key: config.openai.apiKey };
  config.pgvector.databaseUrl = "";
  config.openai.apiKey = "test-key";

  try {
    await assert.rejects(
      createMemoryStore(),
      (error) => {
        assert.ok(error instanceof AdapterError);
        assert.equal(error.kind, "unavailable");
        assert.equal(error.provider, "pgvector");
        assert.match(error.message, /DATABASE_URL|PGVECTOR_DATABASE_URL/);
        return true;
      }
    );
  } finally {
    config.pgvector.databaseUrl = orig.db;
    config.openai.apiKey = orig.key;
  }
});

test("pgvector adapter is unavailable without OpenAI key", async () => {
  const orig = { db: config.pgvector.databaseUrl, key: config.openai.apiKey };
  config.pgvector.databaseUrl = "postgresql://localhost:5432/gofer";
  config.openai.apiKey = "";

  try {
    await assert.rejects(
      createMemoryStore(),
      (error) => {
        assert.ok(error instanceof AdapterError);
        assert.equal(error.kind, "unavailable");
        assert.equal(error.provider, "pgvector");
        assert.match(error.message, /OPENAI_API_KEY/);
        return true;
      }
    );
  } finally {
    config.pgvector.databaseUrl = orig.db;
    config.openai.apiKey = orig.key;
  }
});

// ── Integration tests (skip without env vars) ─────────────────────────────────

const canIntegrate = Boolean(process.env.DATABASE_URL && process.env.OPENAI_API_KEY);
const skipReason = "set DATABASE_URL and OPENAI_API_KEY to run integration tests";

describe("pgvector integration", { skip: canIntegrate ? false : skipReason }, () => {
  let store;
  const userId = `test-${randomUUID()}`;

  before(async () => {
    store = await createMemoryStore();
  });

  after(async () => {
    // Clean up all rows written under the test userId.
    // Access the pool via the store's internal query by recalling with k=1000
    // — simpler: just use a raw delete via a second connection.
    const pg = await import("pg");
    const client = new pg.default.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("DELETE FROM gofer_memories WHERE user_id = $1", [userId]);
    await client.end();
  });

  test("createMemoryStore returns a MemoryStore instance", () => {
    assert.ok(store instanceof MemoryStore);
  });

  test("write rejects a fact missing userId", async () => {
    await assert.rejects(
      store.write({ text: "hello" }),
      (error) => {
        assert.ok(error instanceof AdapterError);
        assert.equal(error.kind, "invalid");
        return true;
      }
    );
  });

  test("write rejects a fact missing text", async () => {
    await assert.rejects(
      store.write({ userId }),
      (error) => {
        assert.ok(error instanceof AdapterError);
        assert.equal(error.kind, "invalid");
        return true;
      }
    );
  });

  test("recall rejects when userId is missing", async () => {
    await assert.rejects(
      store.recall("", "dentist"),
      (error) => {
        assert.ok(error instanceof AdapterError);
        assert.equal(error.kind, "invalid");
        return true;
      }
    );
  });

  test("recall rejects when query is missing", async () => {
    await assert.rejects(
      store.recall(userId, ""),
      (error) => {
        assert.ok(error instanceof AdapterError);
        assert.equal(error.kind, "invalid");
        return true;
      }
    );
  });

  test("write returns an id", async () => {
    const result = await store.write({
      userId,
      kind: "fact",
      text: "User prefers morning dental appointments"
    });
    assert.ok(typeof result.id === "string");
    assert.ok(result.id.length > 0);
  });

  test("recall finds a written fact with a related query", async () => {
    await store.write({
      userId,
      kind: "preference",
      text: "User is allergic to penicillin"
    });

    const results = await store.recall(userId, "medication allergy");

    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);

    const top = results[0];
    assert.ok(typeof top.score === "number");
    assert.ok(top.score >= 0 && top.score <= 1);
    assert.ok(typeof top.fact.text === "string");
    assert.ok(top.fact.userId === userId);
  });

  test("recall returns empty for an unknown userId", async () => {
    const results = await store.recall(`no-such-user-${randomUUID()}`, "anything");
    assert.deepEqual(results, []);
  });

  test("recall respects the k limit", async () => {
    await Promise.all([
      store.write({ userId, kind: "fact", text: "User likes jazz music" }),
      store.write({ userId, kind: "fact", text: "User prefers Python over JavaScript" }),
      store.write({ userId, kind: "fact", text: "User has a cat named Mochi" })
    ]);

    const results = await store.recall(userId, "user preferences", 2);
    assert.ok(results.length <= 2);
  });

  test("recall result scores are in descending order", async () => {
    const results = await store.recall(userId, "user preferences", 5);
    for (let i = 1; i < results.length; i++) {
      assert.ok(
        results[i - 1].score >= results[i].score,
        `scores should be descending: ${results[i - 1].score} < ${results[i].score}`
      );
    }
  });

  test("facts written under one userId are invisible to another", async () => {
    const otherUser = `test-${randomUUID()}`;
    await store.write({ userId, kind: "fact", text: "Secret fact for userId only" });
    const results = await store.recall(otherUser, "secret fact");
    assert.deepEqual(results, []);
  });
});
