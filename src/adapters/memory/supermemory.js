import { MemoryStore } from "../../interfaces/MemoryStore.js";
import { AdapterError } from "../../interfaces/AdapterError.js";
import { config } from "../../lib/config.js";
import { saveMemory, searchMemory } from "../../integrations/memory.js";

export async function createMemoryStore() {
  if (!config.supermemory.apiKey && !config.demo.mode) {
    throw new AdapterError(
      "unavailable",
      "Supermemory adapter requires SUPERMEMORY_API_KEY",
      { provider: "supermemory" }
    );
  }
  return new SupermemoryMemoryStore();
}

class SupermemoryMemoryStore extends MemoryStore {
  async write(fact) {
    if (!fact?.userId || !fact?.text) {
      throw new AdapterError(
        "invalid",
        "MemoryStore.write requires userId and text.",
        { provider: "supermemory", errandId: fact?.errandId }
      );
    }

    let result;
    try {
      result = await saveMemory({
        content: buildContent(fact)
      });
    } catch (error) {
      throw new AdapterError(
        "unknown",
        `Supermemory write failed: ${error.message}`,
        { provider: "supermemory", errandId: fact.errandId, cause: error }
      );
    }

    const data = result.data || {};
    return {
      id: data.id || data.documentId || `sm-${Date.now()}`
    };
  }

  async recall(userId, query, k = 5) {
    if (!userId || !query) {
      throw new AdapterError(
        "invalid",
        "MemoryStore.recall requires userId and query.",
        { provider: "supermemory" }
      );
    }

    let result;
    try {
      result = await searchMemory({
        query: `user:${userId} ${query}`,
        localMemory: []
      });
    } catch (error) {
      throw new AdapterError(
        "unknown",
        `Supermemory recall failed: ${error.message}`,
        { provider: "supermemory", cause: error }
      );
    }

    const matches = result.topMatches || [];
    return matches.slice(0, k).map((match) => ({
      fact: {
        userId,
        kind: "fact",
        text: match.content || "",
        meta: {},
        errandId: null
      },
      score: typeof match.score === "number" ? match.score : 0
    }));
  }
}

function buildContent(fact) {
  const parts = [`user:${fact.userId}`];
  if (fact.kind) parts.push(`kind:${fact.kind}`);
  parts.push(fact.text);
  if (fact.errandId) parts.push(`errand:${fact.errandId}`);
  return parts.join(" | ");
}
