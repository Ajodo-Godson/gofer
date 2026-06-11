import { Mailer } from "../../interfaces/Mailer.js";
import { AdapterError } from "../../interfaces/AdapterError.js";
import { config } from "../../lib/config.js";
import { sendEmail } from "../../integrations/agentmail.js";

const BASE_URL = "https://api.agentmail.to/v0";

export async function createMailer() {
  if (!config.agentMail.apiKey && !config.demo.mode) {
    throw new AdapterError(
      "unavailable",
      "AgentMail adapter requires AGENTMAIL_API_KEY",
      { provider: "agentmail" }
    );
  }
  return new AgentMailMailer();
}

class AgentMailMailer extends Mailer {
  async send(mail) {
    if (!mail?.to || !mail?.subject || !mail?.body) {
      throw new AdapterError(
        "invalid",
        "Mailer.send requires to, subject, and body.",
        { provider: "agentmail", errandId: mail?.errandId }
      );
    }

    let result;
    try {
      result = await sendEmail({
        to: mail.to,
        subject: mail.subject,
        text: mail.body
      });
    } catch (error) {
      throw new AdapterError(
        "unknown",
        `AgentMail send failed: ${error.message}`,
        { provider: "agentmail", errandId: mail.errandId, cause: error }
      );
    }

    const data = result.data || {};
    return {
      messageId: data.messageId || data.message_id || data.id || `sim-${Date.now()}`,
      threadId: data.threadId || data.thread_id || mail.threadId || ""
    };
  }

  async poll(threadId) {
    if (!threadId) {
      throw new AdapterError(
        "invalid",
        "Mailer.poll requires a threadId.",
        { provider: "agentmail" }
      );
    }

    const inboxId = config.agentMail.inboxId || config.agentMail.from;
    if (!config.demo.allowRealEmailSend || !config.agentMail.apiKey || !inboxId) {
      // Demo/safety mode: no real messages to return
      return [];
    }
    let response;
    try {
      response = await fetch(
        `${BASE_URL}/inboxes/${encodeURIComponent(inboxId)}/threads/${encodeURIComponent(threadId)}/messages`,
        {
          headers: { Authorization: `Bearer ${config.agentMail.apiKey}` }
        }
      );
    } catch (error) {
      throw new AdapterError(
        "unavailable",
        `AgentMail poll failed: ${error.message}`,
        { provider: "agentmail", cause: error }
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AdapterError(
        "unknown",
        `AgentMail thread fetch ${response.status}: ${body}`,
        { provider: "agentmail" }
      );
    }

    const data = await response.json();
    const messages = Array.isArray(data) ? data : (data.messages || data.items || []);
    return messages.map((msg) => ({
      messageId: msg.message_id || msg.messageId || msg.id || "",
      from: msg.from || "",
      subject: msg.subject || "",
      body: msg.text || msg.body || msg.preview || "",
      threadId: msg.thread_id || msg.threadId || threadId,
      receivedAt: msg.timestamp || msg.created_at || msg.receivedAt || ""
    }));
  }
}
