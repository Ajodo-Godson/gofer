import { Payments } from "../../interfaces/Payments.js";
import { AdapterError } from "../../interfaces/AdapterError.js";
import { config } from "../../lib/config.js";
import { requirePaymentApproval } from "../../integrations/payments.js";

export async function createPayments() {
  // Sponge is a placeholder-only provider; it is always instantiable
  // (no live API is needed to create the adapter), but charge() will
  // gate behind approval and an API key check at call time.
  return new SpongePayments();
}

class SpongePayments extends Payments {
  async prepare(req) {
    if (!req?.userId || !req?.amountCents || !req?.currency || !req?.description) {
      throw new AdapterError(
        "invalid",
        "Payments.prepare requires userId, amountCents, currency, and description.",
        { provider: "sponge", errandId: req?.errandId }
      );
    }
    if (req.amountCents <= 0) {
      throw new AdapterError(
        "invalid",
        "Payments.prepare requires a positive amountCents.",
        { provider: "sponge", errandId: req.errandId }
      );
    }

    const intentId = `sponge-intent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      intentId,
      amountCents: req.amountCents,
      description: req.description,
      status: "requires_approval"
    };
  }

  async charge(intentId, approvalToken) {
    if (!intentId) {
      throw new AdapterError(
        "invalid",
        "Payments.charge requires an intentId.",
        { provider: "sponge" }
      );
    }

    let result;
    try {
      result = await requirePaymentApproval({
        amount: intentId,
        description: intentId,
        approvalToken
      });
    } catch (error) {
      throw new AdapterError(
        "unknown",
        `Sponge charge failed: ${error.message}`,
        { provider: "sponge", cause: error }
      );
    }

    if (result.status === "approval_required") {
      throw new AdapterError(
        "auth",
        "Payment requires explicit user approval before charging.",
        { provider: "sponge" }
      );
    }

    if (result.status === "adapter_missing" || result.status === "not_charged") {
      throw new AdapterError(
        "unavailable",
        result.blocker || "Sponge payment adapter is not fully implemented.",
        { provider: "sponge" }
      );
    }

    return {
      receiptId: result.receiptId || `sponge-receipt-${Date.now()}`
    };
  }
}
