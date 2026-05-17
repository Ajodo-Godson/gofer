import { config } from "../lib/config.js";

export async function chargeAgentWallet({ amount, description }) {
  return requirePaymentApproval({ amount, description });
}

export async function requirePaymentApproval({ amount, description, approvalToken }) {
  if (!approvalToken) {
    return {
      mode: "blocked",
      provider: "Sponge",
      success: false,
      amount,
      description,
      status: "approval_required",
      blocker: "Payment confirmation is required before GOFER can charge, authorize, or prepare wallet/card payment."
    };
  }

  if (!config.sponge.apiKey) {
    await wait(400);
    return {
      mode: "simulated",
      provider: "Sponge",
      success: false,
      amount,
      description,
      status: "not_charged",
      blocker: "No Sponge API key is configured. GOFER did not charge or authorize a wallet payment."
    };
  }

  return {
    mode: "blocked",
    provider: "Sponge",
    success: false,
    status: "adapter_missing",
    blocker: "Sponge SDK/API adapter is not implemented for the available credential shape. GOFER did not charge or authorize a wallet payment.",
    amount,
    description
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
