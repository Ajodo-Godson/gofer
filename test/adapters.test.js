/**
 * Contract tests for owned adapter implementations.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { AdapterError, Payments } from "../src/interfaces/index.js";

// --- payments/sponge ---

test("sponge adapter: factory returns a Payments subclass", async () => {
  const { createPayments } = await import("../src/adapters/payments/sponge.js");
  assert.equal(typeof createPayments, "function");
  const payments = await createPayments();
  assert.ok(payments instanceof Payments, "should be a Payments instance");
});

test("sponge adapter: prepare() rejects missing userId", async () => {
  const { createPayments } = await import("../src/adapters/payments/sponge.js");
  const payments = await createPayments();
  await assert.rejects(
    payments.prepare({ amountCents: 1000, currency: "usd", description: "Test", errandId: "e5" }),
    (error) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "invalid");
      assert.equal(error.provider, "sponge");
      return true;
    }
  );
});

test("sponge adapter: prepare() rejects zero amountCents", async () => {
  const { createPayments } = await import("../src/adapters/payments/sponge.js");
  const payments = await createPayments();
  await assert.rejects(
    payments.prepare({ userId: "u1", amountCents: 0, currency: "usd", description: "Test" }),
    (error) => {
      assert.equal(error instanceof AdapterError, true);
      assert.equal(error.kind, "invalid");
      return true;
    }
  );
});

test("sponge adapter: prepare() returns a PreparedPayment", async () => {
  const { createPayments } = await import("../src/adapters/payments/sponge.js");
  const payments = await createPayments();
  const result = await payments.prepare({
    userId: "u1",
    amountCents: 1500,
    currency: "usd",
    description: "Dental visit copay",
    errandId: "e5"
  });
  assert.ok(typeof result.intentId === "string" && result.intentId.length > 0, "intentId must be non-empty");
  assert.equal(result.amountCents, 1500);
  assert.equal(typeof result.description, "string");
  assert.equal(result.status, "requires_approval");
});

test("sponge adapter: charge() rejects missing intentId", async () => {
  const { createPayments } = await import("../src/adapters/payments/sponge.js");
  const payments = await createPayments();
  await assert.rejects(
    payments.charge("", "token-abc"),
    (error) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "invalid");
      return true;
    }
  );
});

test("sponge adapter: charge() without approvalToken throws auth AdapterError", async () => {
  const { createPayments } = await import("../src/adapters/payments/sponge.js");
  const payments = await createPayments();
  await assert.rejects(
    payments.charge("sponge-intent-123", null),
    (error) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "auth");
      assert.equal(error.provider, "sponge");
      return true;
    }
  );
});
