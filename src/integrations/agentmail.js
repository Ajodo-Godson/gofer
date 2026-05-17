import { config } from "../lib/config.js";

const BASE_URL = "https://api.agentmail.to/v0";

export async function sendEmail({ to, subject, text }) {
  if (!config.demo.allowRealEmailSend || !config.agentMail.apiKey || !config.agentMail.from) {
    await wait(300);
    return {
      mode: "simulated",
      provider: "AgentMail",
      to,
      subject,
      text
    };
  }

  const inboxId = config.agentMail.inboxId || config.agentMail.from;
  const response = await fetch(`${BASE_URL}/inboxes/${encodeURIComponent(inboxId)}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.agentMail.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      to,
      subject,
      text,
      html: `<p>${escapeHtml(text).replaceAll("\n", "<br>")}</p>`
    })
  });

  if (!response.ok) {
    throw new Error(`AgentMail send failed: ${response.status} ${await response.text()}`);
  }

  return {
    mode: "real",
    provider: "AgentMail",
    data: await response.json()
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
