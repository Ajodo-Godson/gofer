import { VoiceCaller } from "../../interfaces/VoiceCaller.js";
import { AdapterError } from "../../interfaces/AdapterError.js";
import { config } from "../../lib/config.js";

const E164_RE = /^\+[1-9]\d{7,14}$/;

// Simulation mode: safety toggle off, or credentials not present
function isSimulationMode() {
  return !config.demo.allowRealCalls || !config.twilio.accountSid || !config.twilio.authToken;
}

// XML-escape special characters before embedding in TwiML
function escapeXml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildTwiml(objective, context) {
  const safeObjective = escapeXml(objective);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `  <Say voice="Polly.Joanna">Hello, I'm calling on behalf of a customer. ${safeObjective}</Say>`,
    '  <Record maxLength="120" transcribe="false" />',
    "  <Say>Thank you. Goodbye.</Say>",
    "  <Hangup/>",
    "</Response>"
  ].join("\n");
}

function mapCallStatus(twilioStatus) {
  const s = String(twilioStatus || "").toLowerCase();
  if (s === "queued" || s === "initiated") return "queued";
  if (s === "ringing" || s === "in-progress") return "in_progress";
  if (s === "completed") return "completed";
  if (s === "failed" || s === "busy" || s === "no-answer" || s === "canceled") return "failed";
  return "queued";
}

function mapCallOutcome(twilioStatus) {
  const s = String(twilioStatus || "").toLowerCase();
  if (s === "completed") return "completed";
  if (s === "no-answer" || s === "busy") return "no_answer";
  if (s === "failed" || s === "canceled") return "failed";
  // In-progress statuses — treat as completed with note
  return "completed";
}

function mapTwilioError(error) {
  const code = error.code || error.status;
  const msg = error.message || String(error);

  if (code === 20003 || /authentication/i.test(msg)) {
    return new AdapterError("auth", `Twilio authentication failed: ${msg}`, {
      provider: "twilio",
      cause: error
    });
  }
  if (code === 21211 || /invalid.*number/i.test(msg)) {
    return new AdapterError("invalid", `Twilio invalid To number: ${msg}`, {
      provider: "twilio",
      cause: error
    });
  }
  if (code === 21214 || /cannot.*call/i.test(msg)) {
    return new AdapterError("blocked", `Twilio cannot call number: ${msg}`, {
      provider: "twilio",
      cause: error
    });
  }
  return new AdapterError("unavailable", `Twilio error: ${msg}`, {
    provider: "twilio",
    cause: error
  });
}

export async function createVoiceCaller(options = {}) {
  return new TwilioVoiceCaller(options);
}

class TwilioVoiceCaller extends VoiceCaller {
  async call(req) {
    if (!req?.toNumber) {
      throw new AdapterError(
        "invalid",
        "VoiceCaller.call requires toNumber.",
        { provider: "twilio", errandId: req?.errandId }
      );
    }
    if (!E164_RE.test(req.toNumber)) {
      throw new AdapterError(
        "invalid",
        `toNumber must be in E.164 format (e.g. +15551234567). Got: ${req.toNumber}`,
        { provider: "twilio", errandId: req?.errandId }
      );
    }
    if (!req?.objective) {
      throw new AdapterError(
        "invalid",
        "VoiceCaller.call requires objective.",
        { provider: "twilio", errandId: req?.errandId }
      );
    }

    // Simulation mode
    if (isSimulationMode()) {
      return { callId: `sim-${Date.now()}`, status: "queued" };
    }

    // Real mode
    let twilio;
    try {
      twilio = (await import("twilio")).default;
    } catch {
      throw new AdapterError(
        "unavailable",
        "twilio package could not be imported. Run: npm install twilio",
        { provider: "twilio", errandId: req.errandId }
      );
    }

    const { accountSid, authToken, fromNumber, statusCallbackUrl } = config.twilio;

    if (!E164_RE.test(fromNumber)) {
      throw new AdapterError(
        "invalid",
        `config.twilio.fromNumber must be in E.164 format. Got: ${fromNumber}`,
        { provider: "twilio", errandId: req?.errandId }
      );
    }

    const client = twilio(accountSid, authToken);

    let call;
    try {
      call = await client.calls.create({
        to: req.toNumber,
        from: fromNumber,
        twiml: buildTwiml(req.objective, req.context),
        record: true,
        recordingChannels: "dual",
        ...(statusCallbackUrl ? { statusCallback: statusCallbackUrl, statusCallbackMethod: "POST" } : {})
      });
    } catch (error) {
      throw mapTwilioError(error);
    }

    return {
      callId: call.sid,
      status: mapCallStatus(call.status)
    };
  }

  async result(callId) {
    if (!callId) {
      throw new AdapterError(
        "invalid",
        "VoiceCaller.result requires a callId.",
        { provider: "twilio" }
      );
    }

    // Simulation mode
    if (isSimulationMode()) {
      return {
        callId,
        outcome: "completed",
        transcript: "[simulated call transcript]",
        structured: null
      };
    }

    // Real mode
    let twilio;
    try {
      twilio = (await import("twilio")).default;
    } catch {
      throw new AdapterError(
        "unavailable",
        "twilio package could not be imported.",
        { provider: "twilio" }
      );
    }

    const { accountSid, authToken } = config.twilio;
    const client = twilio(accountSid, authToken);

    let call;
    try {
      call = await client.calls(callId).fetch();
    } catch (error) {
      throw mapTwilioError(error);
    }

    const outcome = mapCallOutcome(call.status);

    // Fetch recording and attempt transcription
    let transcript = "[no transcript available]";
    try {
      const recordings = await client.recordings.list({ callSid: callId, limit: 1 });
      if (recordings.length > 0 && process.env.OPENAI_API_KEY) {
        const recording = recordings[0];
        const recordingUrl = `https://api.twilio.com${recording.uri.replace(".json", ".mp3")}`;

        // Download the recording MP3
        const audioResp = await fetch(recordingUrl, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`
          }
        });

        if (audioResp.ok) {
          const audioBuffer = await audioResp.arrayBuffer();
          const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });

          // Post to OpenAI Whisper
          const formData = new FormData();
          formData.append("file", audioBlob, "recording.mp3");
          formData.append("model", "whisper-1");

          const whisperResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: formData
          });

          if (whisperResp.ok) {
            const whisperData = await whisperResp.json();
            transcript = whisperData.text || "[no transcript available]";
          }
        }
      }
    } catch {
      // Transcript fetch is best-effort; never throw
      transcript = "[no transcript available]";
    }

    return {
      callId,
      outcome,
      transcript,
      structured: null
    };
  }
}
