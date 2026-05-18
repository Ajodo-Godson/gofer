import { config } from "../lib/config.js";
import { registerAppointmentCall, registerGenericCall } from "../lib/voiceController.js";

export async function placeCall({ to, prompt, taskTitle, initialGreeting, appointmentContext, callContext }) {
  if (!config.demo.allowRealCalls || !config.agentPhone.apiKey || !config.agentPhone.agentId) {
    return simulateCall({ to, prompt, taskTitle, appointmentContext, callContext });
  }

  registerCallContext({ callId: null, to, taskTitle, prompt, appointmentContext, callContext });

  const response = await fetch(`${config.agentPhone.baseUrl}/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.agentPhone.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      agentId: config.agentPhone.agentId,
      toNumber: to,
      fromNumber: config.agentPhone.fromNumber,
      initialGreeting: initialGreeting || "Hi, I am calling to book a dental appointment.",
      systemPrompt: prompt,
      instructions: prompt,
      metadata: {
        taskTitle,
        prompt,
        appointmentContext,
        callContext,
        voiceMode: appointmentContext ? "strict-appointment-webhook" : "strict-task-webhook",
        allowedPurpose: appointmentContext ? "book_dental_appointment" : "complete_phone_errand",
        forbiddenTopics: appointmentContext?.forbiddenTopics || callContext?.forbiddenTopics || []
      }
    })
  });

  if (!response.ok) {
    throw new Error(`AgentPhone call failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const callId = data.id || data.callId || data.data?.id || data.data?.callId;
  registerCallContext({
    callId,
    to,
    taskTitle,
    prompt,
    appointmentContext,
    callContext
  });

  const completed = callId ? await waitForCallCompletion(callId) : null;
  const transcript = completed?.status === "completed"
    ? await fetchTranscriptTurns(callId)
    : [];
  const summarized = summarizePhoneResult({ taskTitle, transcript, callContext, appointmentContext, completed });

  return {
    mode: "real",
    provider: "AgentPhone",
    data,
    callId,
    status: completed?.status || data.status || "placed",
    transcript,
    result: summarized || "Call placed; waiting for AgentPhone transcript/outcome."
  };
}

export async function sendSms({ to, body }) {
  if (!config.demo.allowRealSmsSend || !config.agentPhone.apiKey || !config.agentPhone.agentId) {
    return {
      mode: "simulated",
      provider: "AgentPhone",
      message: body,
      to
    };
  }

  const response = await fetch(`${config.agentPhone.baseUrl}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.agentPhone.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      agentId: config.agentPhone.agentId,
      to,
      body
    })
  });

  if (!response.ok) {
    throw new Error(`AgentPhone SMS failed: ${response.status} ${await response.text()}`);
  }

  return {
    mode: "real",
    provider: "AgentPhone",
    data: await response.json()
  };
}

function registerCallContext({ callId, to, taskTitle, prompt, appointmentContext, callContext }) {
  if (appointmentContext) {
    registerAppointmentCall({ callId, to, taskTitle, prompt, appointmentContext });
    return;
  }
  registerGenericCall({ callId, to, taskTitle, prompt, callContext });
}

async function waitForCallCompletion(callId) {
  const deadline = Date.now() + 120000;
  let last = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${config.agentPhone.baseUrl}/calls/${callId}`, {
      headers: {
        Authorization: `Bearer ${config.agentPhone.apiKey}`
      }
    });
    if (!response.ok) {
      throw new Error(`AgentPhone call status failed: ${response.status} ${await response.text()}`);
    }
    last = await response.json();
    if (["completed", "failed", "canceled", "cancelled"].includes(String(last.status || "").toLowerCase())) {
      return last;
    }
    await wait(2000);
  }
  return last;
}

async function fetchTranscriptTurns(callId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${config.agentPhone.baseUrl}/calls/${callId}/transcript/stream`, {
      headers: {
        Authorization: `Bearer ${config.agentPhone.apiKey}`
      },
      signal: controller.signal
    });
    if (!response.ok) return [];
    const text = await response.text();
    return parseSseTranscript(text);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function parseSseTranscript(text) {
  return String(text || "")
    .split(/\n\n+/)
    .map((block) => block.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((item) => item?.role && item?.content)
    .map((item) => ({
      role: item.role,
      content: String(item.content || "").trim(),
      createdAt: item.createdAt || null
    }));
}

function summarizePhoneResult({ taskTitle, transcript, callContext, appointmentContext, completed }) {
  if (completed?.status && completed.status !== "completed") {
    return `Phone call ${completed.status}.`;
  }

  const usefulUserTurns = transcript
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content)
    .filter((content) => !/^\s*(hello|hi|hey|yes|yeah|yep)\s*[?.!]*\s*$/i.test(content));
  const lastUseful = usefulUserTurns.at(-1);

  if (callContext) {
    if (needsActionableTiming(callContext) && lastUseful && !hasSpecificTime(lastUseful)) {
      return `Phone call completed, but only vague availability was captured: ${lastUseful}`;
    }
    return lastUseful
      ? `Phone call completed: ${lastUseful}`
      : "Phone call completed, but no clear answer was captured.";
  }

  if (appointmentContext) {
    const transcriptText = transcript.map((turn) => turn.content).join(" ");
    if (/website|web site|online|portal|book it yourself|go book|use the site|not by phone/i.test(transcriptText)) {
      return "Phone call completed: provider said the appointment must be booked online or through their website.";
    }
    if (/business is closed|office is closed|closed|no more appointments|no appointments|not taking appointments|none available|not possible/i.test(transcriptText)) {
      return "Phone call completed: provider said no appointment could be booked by phone.";
    }
    const time = transcriptText.match(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)?\s*(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i)?.[0]?.trim();
    if (time && appointmentWasConfirmed(transcriptText)) {
      return `Phone call completed: appointment confirmed for ${time}.`;
    }
    return time
      ? `Phone call completed, but appointment confirmation is unclear. Discussed time: ${time}.`
      : "Phone call completed, but no appointment time was confirmed.";
  }

  return taskTitle ? `Phone call completed for: ${taskTitle}` : "Phone call completed.";
}

function needsActionableTiming(callContext) {
  return /scheduling|time|time window|timing|act on/i.test(callContext?.successGuidance || "");
}

function hasSpecificTime(text) {
  return /\b(?:around\s+|about\s+|after\s+|before\s+|by\s+|at\s+|between\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i.test(text || "");
}

async function simulateCall({ to, taskTitle, appointmentContext, callContext }) {
  await wait(900);
  if (callContext) {
    return {
      mode: "simulated",
      provider: "AgentPhone",
      to,
      transcript: [
        `GOFER: Hi, this is Gofer calling for ${callContext.callerName || "the user"}. I am calling to ${callContext.goal || "ask a quick question"}.`,
        "Contact: I am free later this week after work.",
        "GOFER: Got it. I will pass that along. Thank you."
      ],
      result: "Phone errand completed: contact said they are free later this week after work."
    };
  }
  const context = appointmentContext || {};
  const patient = context.patientName || "Ajoson";
  const insurance = context.insurance || "Delta Dental PPO";
  return {
    mode: "simulated",
    provider: "AgentPhone",
    to,
    transcript: [
      `GOFER: Hi, I am calling on behalf of ${patient} to book a dental appointment this week between 2 PM and 5 PM.`,
      "Office: We have Thursday at 3 PM.",
      "GOFER: Thursday at 3 PM works. Is that confirmed on your calendar?",
      "Office: Confirmed for Thursday at 3 PM.",
      "GOFER: Thank you."
    ],
    result: taskTitle.toLowerCase().includes("dentist")
      ? `Phone call completed: appointment confirmed for Thursday at 3 PM${insurance ? `; insurance ${insurance} is available if the office asks later` : ""}.`
      : "Phone errand completed"
  };
}

function appointmentWasConfirmed(text) {
  return /\b(confirmed|booked|scheduled|all set|on (?:the )?calendar|you're set|you are set)\b/i.test(text || "");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
