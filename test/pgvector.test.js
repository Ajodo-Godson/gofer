import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/adapters/memory/pgvector.js";
import { AdapterError } from "../src/interfaces/AdapterError.js";
import { config } from "../src/lib/config.js";

test("pgvector memory adapter is unavailable without database configuration", async () => {
  const previousDatabaseUrl = config.pgvector.databaseUrl;
  const previousOpenAiKey = config.openai.apiKey;
  config.pgvector.databaseUrl = "";
  config.openai.apiKey = "test-key";

  try {
    await assert.rejects(
      createMemoryStore(),
      (error) => {
        assert.equal(error instanceof AdapterError, true);
        assert.equal(error.kind, "unavailable");
        assert.equal(error.provider, "pgvector");
        assert.match(error.message, /DATABASE_URL|PGVECTOR_DATABASE_URL/);
        return true;
      }
    );
  } finally {
    config.pgvector.databaseUrl = previousDatabaseUrl;
    config.openai.apiKey = previousOpenAiKey;
  }
});

test("pgvector memory adapter is unavailable without embeddings configuration", async () => {
  const previousDatabaseUrl = config.pgvector.databaseUrl;
  const previousOpenAiKey = config.openai.apiKey;
  config.pgvector.databaseUrl = "postgresql://localhost:5432/gofer";
  config.openai.apiKey = "";

  try {
    await assert.rejects(
      createMemoryStore(),
      (error) => {
        assert.equal(error instanceof AdapterError, true);
        assert.equal(error.kind, "unavailable");
        assert.equal(error.provider, "pgvector");
        assert.match(error.message, /OPENAI_API_KEY/);
        return true;
      }
    );
  } finally {
    config.pgvector.databaseUrl = previousDatabaseUrl;
    config.openai.apiKey = previousOpenAiKey;
  }
});
