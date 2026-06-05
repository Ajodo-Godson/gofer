import pg from "pg";
import { randomUUID } from "node:crypto";
import { MemoryStore } from "../../interfaces/MemoryStore.js";
import { AdapterError } from "../../interfaces/AdapterError.js";
import { config } from "../../lib/config.js";

const { Pool } = pg;
const EMBEDDING_DIMS = 1536;

export async function createMemoryStore(options = {}) {
  const databaseUrl = config.pgvector.databaseUrl;
  const openaiKey = config.openai.apiKey;

  if (!databaseUrl) {
    throw new AdapterError(
      "unavailable",
      "pgvector adapter requires DATABASE_URL or PGVECTOR_DATABASE_URL",
      { provider: "pgvector" }
    );
  }
  if (!openaiKey) {
    throw new AdapterError(
      "unavailable",
      "pgvector adapter requires OPENAI_API_KEY for embeddings",
      { provider: "pgvector" }
    );
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await ensureSchema(pool);
  } catch (error) {
    await pool.end();
    throw new AdapterError(
      "unavailable",
      `pgvector connection failed: ${error.message}`,
      { provider: "pgvector", cause: error }
    );
  }

  return new PgVectorMemoryStore(pool, openaiKey, config.openai.embeddingModel);
}

class PgVectorMemoryStore extends MemoryStore {
  #pool;
  #openaiKey;
  #model;

  constructor(pool, openaiKey, model) {
    super();
    this.#pool = pool;
    this.#openaiKey = openaiKey;
    this.#model = model;
  }

  async write(fact) {
    if (!fact?.userId || !fact?.text) {
      throw new AdapterError("invalid", "Memory fact requires userId and text.", { provider: "pgvector" });
    }

    try {
      const embedding = await this.#embed(fact.text);
      const { rows } = await this.#pool.query(
        `INSERT INTO gofer_memories (id, user_id, kind, text, meta, errand_id, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
       RETURNING id`,
        [
          randomUUID(),
          fact.userId,
          fact.kind || "fact",
          fact.text,
          JSON.stringify(fact.meta || {}),
          fact.errandId || null,
          vectorLiteral(embedding)
        ]
      );
      return { id: rows[0].id };
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("unknown", `pgvector write failed: ${error.message}`, {
        provider: "pgvector",
        errandId: fact.errandId,
        cause: error
      });
    }
  }

  async recall(userId, query, k = 5) {
    if (!userId || !query) {
      throw new AdapterError("invalid", "Memory recall requires userId and query.", { provider: "pgvector" });
    }

    try {
      const embedding = await this.#embed(query);
      const { rows } = await this.#pool.query(
        `SELECT user_id, kind, text, meta, errand_id,
              1 - (embedding <=> $1::vector) AS score
       FROM gofer_memories
       WHERE user_id = $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
        [vectorLiteral(embedding), userId, k]
      );
      return rows.map((row) => ({
        fact: {
          userId: row.user_id,
          kind: row.kind,
          text: row.text,
          meta: row.meta,
          errandId: row.errand_id
        },
        score: Number(Number(row.score).toFixed(4))
      }));
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("unknown", `pgvector recall failed: ${error.message}`, {
        provider: "pgvector",
        cause: error
      });
    }
  }

  async #embed(text) {
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#openaiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model: this.#model, input: text })
      });
    } catch (error) {
      throw new AdapterError("unavailable", `OpenAI embeddings request failed: ${error.message}`, {
        provider: "pgvector",
        cause: error
      });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AdapterError(
        "unknown",
        `OpenAI embeddings API error ${response.status}: ${body}`,
        { provider: "pgvector" }
      );
    }

    const data = await response.json();
    const embedding = data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      throw new AdapterError("invalid", "OpenAI embeddings response did not include an embedding.", {
        provider: "pgvector"
      });
    }
    return embedding;
  }
}

async function ensureSchema(pool) {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gofer_memories (
      id         uuid        PRIMARY KEY,
      user_id    text        NOT NULL,
      kind       text        NOT NULL DEFAULT 'fact',
      text       text        NOT NULL,
      meta       jsonb       DEFAULT '{}',
      errand_id  text,
      embedding  vector(${EMBEDDING_DIMS}),
      created_at timestamptz DEFAULT now()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS gofer_memories_user_id_idx ON gofer_memories (user_id)"
  );
}

function vectorLiteral(embedding) {
  return `[${embedding.join(",")}]`;
}
