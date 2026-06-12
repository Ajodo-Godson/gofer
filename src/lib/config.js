export const config = {
  port: Number(process.env.PORT || 8787),
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 8787}`,
  providers: {
    voice: envList("VOICE_PROVIDER", ["twilio"]),
    browser: envList("BROWSER_PROVIDER", ["playwright"]),
    mail: envList("MAIL_PROVIDER", ["gmail"]),
    memory: envList("MEMORY_PROVIDER", ["pgvector"]),
    payments: envList("PAYMENT_PROVIDER", ["sponge"])
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    fromNumber: process.env.TWILIO_FROM_NUMBER || "",
    statusCallbackUrl: process.env.TWILIO_STATUS_CALLBACK_URL || ""
  },
  moss: {
    apiKey: process.env.MOSS_API_KEY || "",
    projectId: process.env.MOSS_PROJECT_ID || "",
    projectKey: process.env.MOSS_PROJECT_KEY || "",
    indexName: process.env.MOSS_INDEX_NAME || "gofer-dental-call"
  },
  pgvector: {
    databaseUrl: process.env.PGVECTOR_DATABASE_URL || process.env.DATABASE_URL || ""
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small"
  },
  playwright: {
    enabled: envBool("PLAYWRIGHT_ENABLED", false),
    userDataDir: process.env.PLAYWRIGHT_USER_DATA_DIR || ""
  },
  ollama: {
    baseUrl: normalizeBaseUrl(process.env.OLLAMA_BASE_URL || "http://localhost:11434"),
    model: process.env.OLLAMA_MODEL || "llama3.1"
  },
  gmail: {
    user: process.env.GMAIL_USER || "",
    appPassword: process.env.GMAIL_APP_PASSWORD || ""
  },
  sponge: {
    apiKey: process.env.SPONGE_API_KEY || ""
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || ""
  },
  demo: {
    userPhone: process.env.DEMO_USER_PHONE || process.env.DEMO_TEST_RECIPIENT_PHONE || "",
    userEmail: process.env.DEMO_USER_EMAIL || process.env.DEMO_TEST_RECIPIENT_EMAIL || "",
    agentPhoneCallTarget: process.env.DEMO_AGENTPHONE_CALL_TARGET || "",
    mode: envBool("DEMO_MODE", true),
    allowRealSmsSend: envBool("ALLOW_REAL_SMS_SEND", false),
    allowRealEmailSend: envBool("ALLOW_REAL_EMAIL_SEND", false),
    allowRealCalls: envBool("ALLOW_REAL_RESTAURANT_CALLS", false)
  }
};

export function integrationStatus() {
  return {
    twilio: Boolean(config.demo.allowRealCalls && config.twilio.accountSid && config.twilio.authToken),
    playwright: Boolean(config.playwright.enabled),
    gmail: Boolean(config.demo.allowRealEmailSend && config.gmail.user && config.gmail.appPassword),
    pgvector: Boolean(config.pgvector.databaseUrl && config.openai.apiKey),
    stripe: Boolean(config.stripe.secretKey)
  };
}

export function setupChecklist() {
  return {
    twilio: {
      ready: Boolean(config.demo.allowRealCalls && config.twilio.accountSid && config.twilio.authToken),
      missing: [
        !config.twilio.accountSid && "TWILIO_ACCOUNT_SID",
        !config.twilio.authToken && "TWILIO_AUTH_TOKEN",
        !config.twilio.fromNumber && "TWILIO_FROM_NUMBER",
        !config.demo.allowRealCalls && "ALLOW_REAL_RESTAURANT_CALLS=true"
      ].filter(Boolean)
    },
    playwright: {
      ready: Boolean(config.playwright.enabled),
      missing: [!config.playwright.enabled && "PLAYWRIGHT_ENABLED=true"].filter(Boolean)
    },
    gmail: {
      ready: Boolean(config.demo.allowRealEmailSend && config.gmail.user && config.gmail.appPassword),
      missing: [
        !config.gmail.user && "GMAIL_USER",
        !config.gmail.appPassword && "GMAIL_APP_PASSWORD",
        !config.demo.allowRealEmailSend && "ALLOW_REAL_EMAIL_SEND=true"
      ].filter(Boolean)
    },
    pgvector: {
      ready: Boolean(config.pgvector.databaseUrl && config.openai.apiKey),
      missing: [
        !config.pgvector.databaseUrl && "DATABASE_URL or PGVECTOR_DATABASE_URL",
        !config.openai.apiKey && "OPENAI_API_KEY"
      ].filter(Boolean)
    },
    stripe: {
      ready: Boolean(config.stripe.secretKey),
      missing: [!config.stripe.secretKey && "STRIPE_SECRET_KEY"].filter(Boolean)
    }
  };
}

function envBool(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envList(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBaseUrl(url) {
  return url.replace(/\/$/, "");
}
