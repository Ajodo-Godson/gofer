import { config } from "../lib/config.js";

const SUPERMEMORY_URL = "https://api.supermemory.ai/v3";

export async function searchMemory({ query, localMemory }) {
  if (!config.supermemory.apiKey) {
    const results = localMemory
      .filter((item) => item.content.toLowerCase().includes(query.toLowerCase().split(" ")[0]))
      .slice(0, 5);
    return {
      mode: "simulated",
      provider: "Supermemory",
      results,
      topMatches: results.map((item) => ({
        score: null,
        title: null,
        content: item.content,
        documentId: null
      }))
    };
  }

  const response = await fetch(`${SUPERMEMORY_URL}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.supermemory.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      q: query,
      userId: config.supermemory.userId,
      limit: 5
    })
  });

  if (!response.ok) {
    throw new Error(`Supermemory search failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return {
    mode: "real",
    provider: "Supermemory",
    data,
    topMatches: normalizeSupermemoryMatches(data),
    timingMs: typeof data.timing === "number" ? Math.round(data.timing) : null
  };
}

// Flattens the Supermemory search response into the smallest shape the
// dashboard / orchestrator need. Each result has at least one chunk; we
// take the top-scoring chunk per document.
//
// Reference: https://docs.supermemory.ai/memory-api/searching/searching-memories
function normalizeSupermemoryMatches(data) {
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .map((result) => {
      const chunk = Array.isArray(result.chunks)
        ? result.chunks.reduce((best, current) => {
            if (!best) return current;
            if (typeof current?.score !== "number") return best;
            if (typeof best.score !== "number" || current.score > best.score) return current;
            return best;
          }, null)
        : null;
      return {
        score: typeof result.score === "number" ? Number(result.score.toFixed(3)) : null,
        title: result.title || null,
        content: chunk?.content || null,
        documentId: result.documentId || null
      };
    })
    .filter((match) => match.content);
}

export async function saveMemory({ content }) {
  if (!config.supermemory.apiKey) {
    return {
      mode: "simulated",
      provider: "Supermemory",
      content
    };
  }

  const response = await fetch(`${SUPERMEMORY_URL}/memories`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.supermemory.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      content,
      userId: config.supermemory.userId,
      projectId: config.supermemory.projectId
    })
  });

  if (!response.ok) {
    throw new Error(`Supermemory save failed: ${response.status} ${await response.text()}`);
  }

  return {
    mode: "real",
    provider: "Supermemory",
    data: await response.json()
  };
}

export async function retrieveMossContext({ query, user }) {
  // Three tiers, in order of preference:
  //   real      - Moss SDK with real project credentials
  //   fallback  - local keyword match against the same corpus, used when
  //               credentials are missing or the SDK call fails/times out
  //   simulated - no corpus and no credentials; existing demo behavior
  //
  // The shape returned is consistent across all tiers so existing callers
  // (orchestrator, worker) keep working without changes:
  //   { mode, provider, facts: string[], latencyMs: number, query }

  if (config.moss.projectId && config.moss.projectKey) {
    try {
      return await retrieveFromMossCloud(query);
    } catch (error) {
      // Fall through to local fallback. We surface the error in the result
      // so the dashboard can show what happened, but never throw out of
      // this function - callers expect a result object.
      const fallback = await retrieveFromLocalCorpus(query);
      return {
        ...fallback,
        mode: "fallback",
        warning: `Moss SDK call failed: ${error.message}. Used local corpus instead.`
      };
    }
  }

  // No real credentials configured. Try the local corpus first (gives real
  // retrieval shape and useful results), fall back to the legacy stub if
  // the corpus file is missing.
  const local = await retrieveFromLocalCorpus(query);
  if (local) return local;

  return {
    mode: "simulated",
    provider: "Moss",
    latencyMs: 7,
    facts: [
      `Name: ${user.name}`,
      `Dental plan: ${user.insurance.dentalProvider}`,
      `Member ID: ${user.insurance.memberId}`,
      `Preferred times: ${user.preferences.appointmentTimes.join(", ")}`
    ],
    query
  };
}

// Indexes are designed to be loaded once and queried many times. Caching
// the load promise across calls is what gives the sub-10ms claim.
let mossClient = null;
let mossLoadPromise = null;

async function retrieveFromMossCloud(query) {
  if (!mossClient) {
    const { MossClient } = await import("@moss-dev/moss");
    mossClient = new MossClient(config.moss.projectId, config.moss.projectKey);
  }
  if (!mossLoadPromise) {
    mossLoadPromise = mossClient.loadIndex(config.moss.indexName).catch((error) => {
      // Reset so the next call retries cleanly instead of caching a
      // permanent failure.
      mossLoadPromise = null;
      throw error;
    });
  }
  await mossLoadPromise;

  const start = Date.now();
  const result = await mossClient.query(config.moss.indexName, query, { topK: 3 });
  const latencyMs = Date.now() - start;

  const docs = Array.isArray(result?.docs) ? result.docs : [];
  return {
    mode: "real",
    provider: "Moss",
    indexName: config.moss.indexName,
    latencyMs,
    facts: docs.map((doc) => doc.text).filter((text) => typeof text === "string" && text.length > 0),
    matches: docs.map((doc) => ({
      id: doc.id,
      score: typeof doc.score === "number" ? Number(doc.score.toFixed(3)) : null,
      text: doc.text || null,
      metadata: doc.metadata || null
    })),
    query
  };
}

// In-memory loader. Keep the file in this module so the call stays cheap.
// We intentionally do not stream or cache the parsed JSON beyond the first
// load - the corpus is small (kilobytes) and tests confirm parse cost is
// well under 1ms.
let cachedCorpus = null;

async function loadDentalCallCorpus() {
  if (cachedCorpus !== null) return cachedCorpus;
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile("data/moss-corpus/dental-call.json", "utf8");
    cachedCorpus = JSON.parse(raw);
  } catch {
    cachedCorpus = null;
  }
  return cachedCorpus;
}

async function retrieveFromLocalCorpus(query) {
  const corpus = await loadDentalCallCorpus();
  if (!corpus || !Array.isArray(corpus.documents) || corpus.documents.length === 0) {
    return null;
  }

  const start = Date.now();
  const tokens = String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);

  // Simple token-overlap scoring. Not semantic; the point of fallback is
  // to keep the call working when Moss is unreachable, not to replicate
  // its quality.
  const ranked = corpus.documents
    .map((doc) => {
      const haystack = `${doc.text} ${JSON.stringify(doc.metadata || {})}`.toLowerCase();
      const matches = tokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0);
      return { doc, matches };
    })
    .filter((entry) => entry.matches > 0)
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 3);

  const docs = ranked.length > 0 ? ranked.map((entry) => entry.doc) : corpus.documents.slice(0, 3);
  const latencyMs = Date.now() - start;

  return {
    mode: "fallback",
    provider: "Moss",
    indexName: corpus.indexName || "local-corpus",
    latencyMs,
    facts: docs.map((doc) => doc.text),
    matches: docs.map((doc) => ({
      id: doc.id,
      score: null,
      text: doc.text,
      metadata: doc.metadata || null
    })),
    query
  };
}
