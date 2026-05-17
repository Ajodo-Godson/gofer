import { config } from "../lib/config.js";

const SUPERMEMORY_URL = "https://api.supermemory.ai/v3";

export async function searchMemory({ query, localMemory }) {
  if (!config.supermemory.apiKey) {
    return {
      mode: "simulated",
      provider: "Supermemory",
      results: localMemory.filter((item) => item.content.toLowerCase().includes(query.toLowerCase().split(" ")[0])).slice(0, 5)
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
      projectId: config.supermemory.projectId
    })
  });

  if (!response.ok) {
    throw new Error(`Supermemory search failed: ${response.status} ${await response.text()}`);
  }

  return {
    mode: "real",
    provider: "Supermemory",
    data: await response.json()
  };
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
  if (!config.moss.apiKey) {
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

  return {
    mode: "real",
    provider: "Moss",
    note: "Moss SDK/API adapter placeholder. Add endpoint details from hackathon docs if provided.",
    query
  };
}
