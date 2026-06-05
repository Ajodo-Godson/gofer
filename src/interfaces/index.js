import { config } from "../lib/config.js";
import { AdapterError } from "./AdapterError.js";
import { VoiceCaller } from "./VoiceCaller.js";
import { Browser } from "./Browser.js";
import { Mailer } from "./Mailer.js";
import { MemoryStore } from "./MemoryStore.js";
import { Payments } from "./Payments.js";

export { AdapterError } from "./AdapterError.js";
export { VoiceCaller } from "./VoiceCaller.js";
export { Browser } from "./Browser.js";
export { Mailer } from "./Mailer.js";
export { MemoryStore } from "./MemoryStore.js";
export { Payments } from "./Payments.js";

const ADAPTER_MODULES = Object.freeze({
  voice: {
    twilio: "../adapters/voice/twilio.js",
    agentphone: "../adapters/voice/agentphone.js"
  },
  browser: {
    playwright: "../adapters/browser/playwright.js",
    browserUse: "../adapters/browser/browserUse.js"
  },
  mail: {
    gmail: "../adapters/mail/gmail.js",
    agentmail: "../adapters/mail/agentmail.js"
  },
  memory: {
    pgvector: "../adapters/memory/pgvector.js",
    supermemory: "../adapters/memory/supermemory.js"
  },
  payments: {
    stripe: "../adapters/payments/stripe.js",
    sponge: "../adapters/payments/sponge.js"
  }
});

const ADAPTER_EXPORTS = Object.freeze({
  voice: "createVoiceCaller",
  browser: "createBrowser",
  mail: "createMailer",
  memory: "createMemoryStore",
  payments: "createPayments"
});

export async function getVoiceCaller() {
  return resolveAdapter("voice", config.providers.voice);
}

export async function getBrowser() {
  return resolveAdapter("browser", config.providers.browser);
}

export async function getMailer() {
  return resolveAdapter("mail", config.providers.mail);
}

export async function getMemoryStore() {
  return resolveAdapter("memory", config.providers.memory);
}

export async function getPayments() {
  return resolveAdapter("payments", config.providers.payments);
}

export async function resolveAdapter(capability, providerChain, options = {}) {
  const providers = Array.isArray(providerChain) ? providerChain : [providerChain].filter(Boolean);
  let lastError = null;

  for (const provider of providers) {
    try {
      return await loadAdapter(capability, provider, options);
    } catch (error) {
      lastError = error;
      if (!(error instanceof AdapterError) || error.kind !== "unavailable") {
        throw error;
      }
    }
  }

  throw lastError || new AdapterError("unavailable", `No ${capability} provider is configured.`, { provider: null });
}

async function loadAdapter(capability, provider, options = {}) {
  const modulePath = ADAPTER_MODULES[capability]?.[provider];
  if (!modulePath) {
    throw new AdapterError("unavailable", `Unknown ${capability} provider: ${provider}`, { provider });
  }

  try {
    const mod = await import(modulePath);
    const factoryName = ADAPTER_EXPORTS[capability];
    const factory = mod[factoryName] || mod.default;
    if (typeof factory !== "function") {
      throw new AdapterError("invalid", `${provider} does not export ${factoryName}.`, { provider });
    }
    return factory(options);
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError("unavailable", `${provider} adapter is unavailable: ${error.message}`, {
      provider,
      cause: error
    });
  }
}

export function adapterRegistry() {
  return ADAPTER_MODULES;
}
