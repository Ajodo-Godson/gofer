import { config } from "../lib/config.js";

export async function chargeAgentWallet({ amount, description }) {
  if (!config.sponge.apiKey) {
    await wait(400);
    return {
      mode: "simulated",
      provider: "Sponge",
      amount,
      description,
      walletBalance: 145,
      virtualCard: "demo-card-used"
    };
  }

  return {
    mode: "real",
    provider: "Sponge",
    note: "Sponge SDK adapter needs the hackathon wallet credential shape.",
    amount,
    description
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
