import test from "node:test";
import assert from "node:assert/strict";
import {
  AdapterError,
  Browser,
  Mailer,
  MemoryStore,
  Payments,
  VoiceCaller,
  adapterRegistry,
  resolveAdapter
} from "../src/interfaces/index.js";
import { config } from "../src/lib/config.js";

test("interface contracts expose the documented async methods", () => {
  assert.equal(typeof VoiceCaller.prototype.call, "function");
  assert.equal(typeof VoiceCaller.prototype.result, "function");
  assert.equal(typeof Browser.prototype.act, "function");
  assert.equal(typeof Browser.prototype.authSession, "function");
  assert.equal(typeof Mailer.prototype.send, "function");
  assert.equal(typeof Mailer.prototype.poll, "function");
  assert.equal(typeof MemoryStore.prototype.write, "function");
  assert.equal(typeof MemoryStore.prototype.recall, "function");
  assert.equal(typeof Payments.prototype.prepare, "function");
  assert.equal(typeof Payments.prototype.charge, "function");
});

test("AdapterError carries fallback and trace metadata", () => {
  const cause = new Error("network down");
  const error = new AdapterError("unavailable", "Adapter unavailable", {
    provider: "playwright",
    errandId: "errand-1",
    cause
  });

  assert.equal(error.name, "AdapterError");
  assert.equal(error.kind, "unavailable");
  assert.equal(error.provider, "playwright");
  assert.equal(error.errandId, "errand-1");
  assert.equal(error.cause, cause);
});

test("provider config uses owned-only adapters (no vendor fallbacks)", () => {
  assert.deepEqual(config.providers.voice, ["twilio"]);
  assert.deepEqual(config.providers.browser, ["playwright"]);
  assert.deepEqual(config.providers.mail, ["gmail"]);
  assert.deepEqual(config.providers.memory, ["pgvector"]);
  assert.deepEqual(config.providers.payments, ["sponge"]);
});

test("adapter registry includes owned providers", () => {
  const registry = adapterRegistry();
  assert.ok("pgvector" in registry.memory);
  assert.ok("playwright" in registry.browser);
  assert.ok("gmail" in registry.mail);
  assert.ok("sponge" in registry.payments);
  assert.ok("twilio" in registry.voice);
});

test("resolveAdapter falls through unavailable providers and reports the last failure", async () => {
  await assert.rejects(
    resolveAdapter("memory", ["unknownMemory", "alsoMissing"]),
    (error) => {
      assert.equal(error instanceof AdapterError, true);
      assert.equal(error.kind, "unavailable");
      assert.equal(error.provider, "alsoMissing");
      return true;
    }
  );
});
