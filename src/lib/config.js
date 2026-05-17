export const config = {
  port: Number(process.env.PORT || 8787),
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 8787}`,
  agentPhone: {
    apiKey: process.env.AGENTPHONE_API_KEY || "",
    agentId: process.env.AGENTPHONE_AGENT_ID || "",
    fromNumber: process.env.AGENTPHONE_FROM_NUMBER || "",
    webhookSecret: process.env.AGENTPHONE_WEBHOOK_SECRET || "",
    baseUrl: normalizeAgentPhoneBaseUrl(process.env.AGENTPHONE_BASE_URL || "https://api.agentphone.to/v1")
  },
  browserUse: {
    apiKey: process.env.BROWSER_USE_API_KEY || "",
    baseUrl: normalizeBaseUrl(process.env.BROWSER_USE_API_BASE_URL || "https://api.browser-use.com/api/v1"),
    profileId: process.env.BROWSER_USE_PROFILE_ID || "",
    workspaceId: process.env.BROWSER_USE_WORKSPACE_ID || ""
  },
  agentMail: {
    apiKey: process.env.AGENTMAIL_API_KEY || "",
    from: process.env.AGENTMAIL_FROM || process.env.AGENTMAIL_INBOX_ID || "",
    inboxId: process.env.AGENTMAIL_INBOX_ID || ""
  },
  supermemory: {
    apiKey: process.env.SUPERMEMORY_API_KEY || "",
    userId: process.env.SUPERMEMORY_USER_ID || "demo-user",
    projectId: process.env.SUPERMEMORY_PROJECT_ID || "gofer"
  },
  moss: {
    apiKey: process.env.MOSS_API_KEY || ""
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
    allowBrowserUseLiveTask: envBool("ALLOW_BROWSER_USE_LIVE_TASK", false),
    allowRealSmsSend: envBool("ALLOW_REAL_SMS_SEND", false),
    allowRealEmailSend: envBool("ALLOW_REAL_EMAIL_SEND", false),
    allowRealCalls: envBool("ALLOW_REAL_RESTAURANT_CALLS", false)
  }
};

export function integrationStatus() {
  return {
    agentPhone: Boolean(config.demo.allowRealCalls && config.agentPhone.apiKey && config.agentPhone.agentId),
    browserUse: Boolean(config.demo.allowBrowserUseLiveTask && config.browserUse.apiKey),
    agentMail: Boolean(config.demo.allowRealEmailSend && config.agentMail.apiKey && config.agentMail.from),
    supermemory: Boolean(config.supermemory.apiKey),
    moss: Boolean(config.moss.apiKey),
    sponge: Boolean(config.sponge.apiKey),
    stripe: Boolean(config.stripe.secretKey)
  };
}

export function setupChecklist() {
  return {
    agentPhone: {
      ready: Boolean(config.demo.allowRealCalls && config.agentPhone.apiKey && config.agentPhone.agentId),
      missing: [
        !config.agentPhone.apiKey && "AGENTPHONE_API_KEY",
        !config.agentPhone.agentId && "AGENTPHONE_AGENT_ID",
        !config.demo.allowRealCalls && "ALLOW_REAL_RESTAURANT_CALLS=true"
      ].filter(Boolean)
    },
    browserUse: {
      ready: Boolean(config.demo.allowBrowserUseLiveTask && config.browserUse.apiKey),
      missing: [
        !config.browserUse.apiKey && "BROWSER_USE_API_KEY",
        !config.demo.allowBrowserUseLiveTask && "ALLOW_BROWSER_USE_LIVE_TASK=true"
      ].filter(Boolean),
      notes: [
        !config.browserUse.profileId && "DoorDash checkout demo needs BROWSER_USE_PROFILE_ID for fast authenticated browsing."
      ].filter(Boolean)
    },
    agentMail: {
      ready: Boolean(config.demo.allowRealEmailSend && config.agentMail.apiKey && config.agentMail.from),
      missing: [
        !config.agentMail.apiKey && "AGENTMAIL_API_KEY",
        !config.agentMail.from && "AGENTMAIL_FROM or AGENTMAIL_INBOX_ID",
        !config.demo.allowRealEmailSend && "ALLOW_REAL_EMAIL_SEND=true"
      ].filter(Boolean)
    },
    supermemory: {
      ready: Boolean(config.supermemory.apiKey),
      missing: [!config.supermemory.apiKey && "SUPERMEMORY_API_KEY"].filter(Boolean)
    },
    sponge: {
      ready: Boolean(config.sponge.apiKey),
      missing: [!config.sponge.apiKey && "SPONGE_API_KEY"].filter(Boolean)
    }
  };
}

function envBool(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function normalizeBaseUrl(url) {
  return url.replace(/\/$/, "");
}

function normalizeAgentPhoneBaseUrl(url) {
  const clean = normalizeBaseUrl(url);
  return clean.endsWith("/v1") ? clean : `${clean}/v1`;
}
