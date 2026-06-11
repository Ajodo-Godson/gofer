import { Mailer } from "../../interfaces/Mailer.js";
import { AdapterError } from "../../interfaces/AdapterError.js";
import { config } from "../../lib/config.js";

export async function createMailer(options = {}) {
  // Only verify nodemailer when live sending is enabled and credentials are set.
  if (config.demo.allowRealEmailSend && config.gmail.user && config.gmail.appPassword) {
    try {
      await import("nodemailer");
    } catch {
      throw new AdapterError(
        "unavailable",
        "nodemailer package could not be imported. Run: npm install nodemailer",
        { provider: "gmail" }
      );
    }
  }
  return new GmailMailer(options);
}

class GmailMailer extends Mailer {
  async send(mail) {
    if (!mail?.to) {
      throw new AdapterError(
        "invalid",
        "Mailer.send requires a to address.",
        { provider: "gmail", errandId: mail?.errandId }
      );
    }
    if (!mail?.subject) {
      throw new AdapterError(
        "invalid",
        "Mailer.send requires a subject.",
        { provider: "gmail", errandId: mail?.errandId }
      );
    }
    if (!mail?.body) {
      throw new AdapterError(
        "invalid",
        "Mailer.send requires a body.",
        { provider: "gmail", errandId: mail?.errandId }
      );
    }

    // Simulation mode: safety toggle off or no credentials configured.
    if (!config.demo.allowRealEmailSend || !config.gmail.user || !config.gmail.appPassword) {
      const threadId = mail.threadId || `sim-thread-${Date.now()}`;
      return {
        messageId: `sim-${Date.now()}`,
        threadId
      };
    }

    // Real Gmail SMTP send via nodemailer.
    let nodemailer;
    try {
      nodemailer = await import("nodemailer");
    } catch {
      throw new AdapterError(
        "unavailable",
        "nodemailer package could not be imported.",
        { provider: "gmail", errandId: mail.errandId }
      );
    }

    const transporter = nodemailer.default.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: config.gmail.user,
        pass: config.gmail.appPassword
      }
    });

    let info;
    try {
      info = await transporter.sendMail({
        from: config.gmail.user,
        to: mail.to,
        subject: mail.subject,
        text: mail.body,
        ...(mail.threadId ? { references: mail.threadId, inReplyTo: mail.threadId } : {})
      });
    } catch (error) {
      // Nodemailer surfaces auth errors with a code or message containing
      // "EAUTH", "534", "535", "Username and Password not accepted".
      const msg = String(error.message || "");
      if (/EAUTH|534|535|Username and Password not accepted|Invalid credentials/i.test(msg)) {
        throw new AdapterError(
          "auth",
          `Gmail authentication failed: ${error.message}`,
          { provider: "gmail", errandId: mail.errandId, cause: error }
        );
      }
      throw new AdapterError(
        "unknown",
        `Gmail send failed: ${error.message}`,
        { provider: "gmail", errandId: mail.errandId, cause: error }
      );
    }

    return {
      messageId: info.messageId || `gmail-${Date.now()}`,
      threadId: mail.threadId || info.messageId || `gmail-thread-${Date.now()}`
    };
  }

  async poll(threadId) {
    if (!threadId) {
      throw new AdapterError(
        "invalid",
        "Mailer.poll requires a threadId.",
        { provider: "gmail" }
      );
    }

    // Simulation mode: no credentials or live sending disabled.
    if (!config.demo.allowRealEmailSend || !config.gmail.user || !config.gmail.appPassword) {
      return [];
    }

    // Real mode: IMAP polling is not yet implemented.
    throw new AdapterError(
      "unavailable",
      "gmail poll() requires IMAP support which is not yet implemented.",
      { provider: "gmail" }
    );
  }
}
