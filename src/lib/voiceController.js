const calls = new Map();

const DEFAULT_APPOINTMENT = {
  patientName: "Ajoson",
  providerName: "Dr. Carl",
  targetWindow: "this week between 2 PM and 5 PM",
  insurance: "Delta Dental PPO",
  memberId: "884720-DEMO",
  groupNumber: "YC-HACK-26",
  callback: "+1 650 758 7032"
};

export function registerAppointmentCall({ callId, to, taskTitle, prompt, appointmentContext }) {
  const context = {
    callId,
    to,
    taskTitle,
    prompt,
    appointment: {
      ...DEFAULT_APPOINTMENT,
      ...(appointmentContext || {})
    },
    phase: "opened",
    offeredTime: null,
    turns: 0,
    completed: false
  };
  if (callId) calls.set(callId, context);
  calls.set(to, context);
}

export function appointmentVoiceReply(body) {
  const context = getContext(body);
  const message = latestHumanText(body).toLowerCase();
  context.turns += 1;
  const appointment = context.appointment || DEFAULT_APPOINTMENT;

  if (context.completed) {
    return {
      text: "Thanks again. Goodbye.",
      hangup: true
    };
  }

  if (isOffTask(message)) {
    context.phase = "redirected_off_task";
    return short("I am only calling to book the dental appointment. Do you have anything this week between 2 PM and 5 PM?");
  }

  if (asksForInsurance(message)) {
    context.phase = "provided_insurance";
    return short(`The insurance is ${appointment.insurance}. Member ID ${speakId(appointment.memberId)}. Group ${speakId(appointment.groupNumber)}.`);
  }

  if (asksForIdentity(message)) {
    return short(`The appointment is for ${appointment.patientName}. The callback number is ${appointment.callback}.`);
  }

  const time = extractAppointmentTime(message);
  if (time && confirmsAvailability(message)) {
    context.offeredTime = time;
    context.phase = "confirming_time";
    return short(`Yes, please book ${time} for ${appointment.patientName}.`);
  }

  if (isBooked(message) || (context.phase === "confirming_time" && isPositive(message))) {
    context.completed = true;
    const booked = context.offeredTime ? ` for ${context.offeredTime}` : "";
    return {
      text: `Perfect, thank you. Please book that${booked}. Goodbye.`,
      hangup: true
    };
  }

  if (noAvailability(message)) {
    context.phase = "fallback_time";
    return short("No problem. What is the nearest afternoon appointment you have after 2 PM?");
  }

  if (asksForReason(message)) {
    return short("Routine dental appointment or cleaning.");
  }

  if (context.phase === "opened" || context.turns === 1) {
    context.phase = "asked_availability";
    return short(`I am calling to book a dental appointment for ${appointment.patientName}. Do you have anything ${appointment.targetWindow}?`);
  }

  return short(`That works if it is ${appointment.targetWindow}. Can you book it for ${appointment.patientName}?`);
}

export function summarizeCallState(body) {
  const context = getContext(body);
  return {
    phase: context.phase,
    offeredTime: context.offeredTime,
    completed: context.completed,
    turns: context.turns
  };
}

function getContext(body) {
  const callId = body.data?.callId || body.data?.call_id || body.data?.conversationId;
  const phone = body.data?.to || body.data?.from;
  if (callId && calls.has(callId)) return calls.get(callId);

  const context = {
    callId,
    to: phone,
    appointment: DEFAULT_APPOINTMENT,
    phase: "opened",
    offeredTime: null,
    turns: 0,
    completed: false
  };

  if (!callId && phone && calls.has(phone)) return calls.get(phone);

  if (callId) calls.set(callId, context);
  if (phone) calls.set(phone, context);
  return context;
}

function latestHumanText(body) {
  return body.data?.message || body.data?.transcript || body.message || "";
}

function short(text) {
  return { text, hangup: false };
}

function asksForInsurance(text) {
  return /insurance|member|policy|group|ppo|hmo/.test(text);
}

function asksForIdentity(text) {
  return /name|patient|phone|callback|number|date of birth|dob/.test(text);
}

function asksForReason(text) {
  return /reason|what.*for|type of appointment|cleaning|procedure/.test(text);
}

function isOffTask(text) {
  return /what are you building|what.*building|hackathon|startup|software|demo|agent|ai|sponsor|browser use|yc\b/.test(text);
}

function confirmsAvailability(text) {
  return /available|open|have|can do|we can|slot|appointment|works/.test(text) || isPositive(text);
}

function isBooked(text) {
  return /booked|scheduled|confirmed|all set|see you|you are set|got you down/.test(text);
}

function isPositive(text) {
  return /\byes\b|yeah|yep|sure|ok|okay|correct|that works|sounds good|perfect/.test(text);
}

function noAvailability(text) {
  return /no availability|nothing|fully booked|not available|can't|cannot|no slots/.test(text);
}

function extractAppointmentTime(text) {
  const day = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b/i)?.[0];
  const time = text.match(/\b([2-5])(?::([0-5]\d))?\s*(p\.?m\.?|pm)\b/i)?.[0];
  if (day && time) return `${capitalize(day)} at ${normalizeTime(time)}`;
  if (time) return normalizeTime(time);
  return null;
}

function normalizeTime(value) {
  return value.replace(/\s*p\.?m\.?/i, " PM").replace(/pm/i, "PM");
}

function capitalize(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}

function speakId(value) {
  return String(value || "")
    .replace(/-/g, " dash ")
    .replace(/\bDEMO\b/i, "demo")
    .replace(/\bYC\b/i, "Y C")
    .replace(/\s+/g, " ")
    .trim();
}
