import { VoiceCaller } from "../../interfaces/VoiceCaller.js";
import { AdapterError } from "../../interfaces/AdapterError.js";
import { config } from "../../lib/config.js";
import { placeCall } from "../../integrations/agentphone.js";

export async function createVoiceCaller() {
  if (!config.agentPhone.apiKey && !config.demo.mode) {
    throw new AdapterError(
      "unavailable",
      "AgentPhone adapter requires AGENTPHONE_API_KEY",
      { provider: "agentphone" }
    );
  }
  return new AgentPhoneVoiceCaller();
}

class AgentPhoneVoiceCaller extends VoiceCaller {
  async call(req) {
    if (!req?.toNumber || !req?.objective) {
      throw new AdapterError(
        "invalid",
        "VoiceCaller.call requires toNumber and objective.",
        { provider: "agentphone", errandId: req?.errandId }
      );
    }

    let result;
    try {
      result = await placeCall({
        to: req.toNumber,
        prompt: req.objective,
        taskTitle: req.objective,
        callContext: req.context || null,
        appointmentContext: null
      });
    } catch (error) {
      throw new AdapterError(
        "unknown",
        `AgentPhone call failed: ${error.message}`,
        { provider: "agentphone", errandId: req.errandId, cause: error }
      );
    }

    const status = normalizeStatus(result.status);
    return {
      callId: result.callId || result.data?.id || `sim-${Date.now()}`,
      status
    };
  }

  async result(callId) {
    if (!callId) {
      throw new AdapterError(
        "invalid",
        "VoiceCaller.result requires a callId.",
        { provider: "agentphone" }
      );
    }

    if (!config.agentPhone.apiKey) {
      // Demo/simulated: we stored no live call state, return a stub
      return {
        callId,
        outcome: "completed",
        transcript: "",
        structured: null
      };
    }

    let response;
    try {
      response = await fetch(`${config.agentPhone.baseUrl}/calls/${callId}`, {
        headers: { Authorization: `Bearer ${config.agentPhone.apiKey}` }
      });
    } catch (error) {
      throw new AdapterError(
        "unavailable",
        `AgentPhone result fetch failed: ${error.message}`,
        { provider: "agentphone", cause: error }
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AdapterError(
        "unknown",
        `AgentPhone call status ${response.status}: ${body}`,
        { provider: "agentphone" }
      );
    }

    const data = await response.json();
    return {
      callId,
      outcome: normalizeOutcome(data.status),
      transcript: data.transcript || "",
      structured: data.metadata || null
    };
  }
}

function normalizeStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "in_progress" || s === "running") return "in_progress";
  if (s === "completed" || s === "done") return "completed";
  if (s === "failed" || s === "error") return "failed";
  return "queued";
}

function normalizeOutcome(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "completed" || s === "done") return "completed";
  if (s === "failed" || s === "error") return "failed";
  if (s === "no_answer" || s === "no-answer") return "no_answer";
  if (s === "voicemail") return "voicemail";
  return "failed";
}
