import { config } from "../lib/config.js";
import { registerAppointmentCall } from "../lib/voiceController.js";

export async function placeCall({ to, prompt, taskTitle, initialGreeting, appointmentContext }) {
  if (!config.demo.allowRealCalls || !config.agentPhone.apiKey || !config.agentPhone.agentId) {
    return simulateCall({ to, prompt, taskTitle, appointmentContext });
  }

  registerAppointmentCall({
    callId: null,
    to,
    taskTitle,
    prompt,
    appointmentContext
  });

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
        voiceMode: "strict-appointment-webhook",
        allowedPurpose: "book_dental_appointment",
        forbiddenTopics: appointmentContext?.forbiddenTopics || []
      }
    })
  });

  if (!response.ok) {
    throw new Error(`AgentPhone call failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  registerAppointmentCall({
    callId: data.id || data.callId || data.data?.id || data.data?.callId,
    to,
    taskTitle,
    prompt,
    appointmentContext
  });

  return {
    mode: "real",
    provider: "AgentPhone",
    data,
    result: "Call placed; waiting for AgentPhone transcript/outcome."
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

async function simulateCall({ to, taskTitle, appointmentContext }) {
  await wait(900);
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
      `GOFER: That works. The insurance is ${insurance}.`,
      "Office: Confirmed for Thursday at 3 PM.",
      "GOFER: Thank you. Please send any intake forms by email."
    ],
    result: taskTitle.toLowerCase().includes("dentist")
      ? "Dentist booked Thursday 9:00 AM with Dr. Park Dental"
      : "Phone errand completed"
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
