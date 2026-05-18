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
    kind: "appointment",
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

export function registerGenericCall({ callId, to, taskTitle, prompt, callContext }) {
  const context = {
    kind: "generic",
    callId,
    to,
    taskTitle,
    prompt,
    call: {
      callerName: "the user",
      goal: "ask the requested question",
      callback: DEFAULT_APPOINTMENT.callback,
      question: "are you available?",
      dateHint: null,
      followUp: "If they answer vaguely, ask what day or time works.",
      successGuidance: "Use judgment to decide whether the response answers the user's request well enough to act on.",
      socialFollowUp: "Ask only follow-ups that make the answer more useful for the original request.",
      locationHelpful: false,
      ...(callContext || {})
    },
    phase: "opened",
    capturedAnswer: null,
    turns: 0,
    completed: false
  };
  if (callId) calls.set(callId, context);
  calls.set(to, context);
}

export function voiceReply(body) {
  const context = getContext(body);
  if (context.kind === "generic") return genericVoiceReply(body, context);
  return appointmentVoiceReply(body, context);
}

export function appointmentVoiceReply(body, existingContext = null) {
  const context = existingContext || getContext(body);
  const message = latestHumanText(body).toLowerCase();
  context.turns += 1;
  const appointment = context.appointment || DEFAULT_APPOINTMENT;

  if (context.completed) {
    return {
      text: "Thanks again. Goodbye.",
      hangup: true
    };
  }

  if (context.turns >= 8) {
    context.completed = true;
    return {
      text: "I will let Ajoson know I could not complete this by phone. Thank you, goodbye.",
      hangup: true
    };
  }

  if (requiresExternalBooking(message)) {
    context.completed = true;
    context.phase = "external_booking_required";
    return {
      text: "Got it, I will let Ajoson know this has to be booked through the website. Thank you, goodbye.",
      hangup: true
    };
  }

  if (appointmentImpossible(message)) {
    context.completed = true;
    context.phase = "appointment_unavailable";
    return {
      text: "Understood, I will let Ajoson know there are no appointments available by phone. Thank you, goodbye.",
      hangup: true
    };
  }

  if (isOffTask(message)) {
    if (context.phase === "redirected_off_task") {
      context.completed = true;
      return {
        text: "I cannot help with that on this call, so I will let Ajoson know I could not complete the booking by phone. Goodbye.",
        hangup: true
      };
    }
    context.phase = "redirected_off_task";
    return short(`I cannot help with that on this call. I am calling about a dental appointment for ${appointment.patientName}; do you have any availability ${appointment.targetWindow}?`);
  }

  if (asksForInsurance(message)) {
    context.phase = "provided_insurance";
    if (/member|policy|id/.test(message)) {
      return short(`The member ID is ${speakId(appointment.memberId)}.`);
    }
    if (/group/.test(message)) {
      return short(`The group number is ${speakId(appointment.groupNumber)}.`);
    }
    return short(`The insurance is ${appointment.insurance}.`);
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

  if (isBooked(message) || (context.phase === "confirming_time" && strongConfirmation(message))) {
    context.completed = true;
    const booked = context.offeredTime ? ` for ${context.offeredTime}` : "";
    return {
      text: `Perfect, thank you${booked ? `, I have that${booked}` : ""}. Goodbye.`,
      hangup: true
    };
  }

  if (context.phase === "confirming_time" && isSoftPositive(message)) {
    return short("Great, is that confirmed on your calendar?");
  }

  if (noAvailability(message)) {
    if (context.phase === "fallback_time") {
      context.completed = true;
      context.phase = "appointment_unavailable";
      return {
        text: "Understood, I will let Ajoson know there are no afternoon appointments available. Thank you, goodbye.",
        hangup: true
      };
    }
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

  return short(`Can you confirm whether you can book an appointment for ${appointment.patientName} ${appointment.targetWindow}?`);
}

function genericVoiceReply(body, context) {
  const rawMessage = latestHumanText(body);
  const message = rawMessage.toLowerCase();
  context.turns += 1;
  const call = context.call || {};

  if (context.completed) {
    return {
      text: "Thanks again. Goodbye.",
      hangup: true
    };
  }

  if (isOffTask(message)) {
    context.phase = "redirected_off_task";
    return short(call.question || goalQuestion(call));
  }

  if (asksWhoIsCalling(message)) {
    return short(`This is Gofer calling for ${call.callerName || "the user"}. ${call.question || goalQuestion(call)}`);
  }

  if (asksWhatTime(message)) {
    context.phase = "clarified_time";
    return short(call.dateHint ? `Whatever works for you. What time ${call.dateHint} is good?` : "Whatever works for you. What time is good?");
  }

  if (asksForSuggestion(message)) {
    context.completed = true;
    context.capturedAnswer = combineAnswers(context.capturedAnswer, rawMessage);
    return {
      text: `I don't want to guess. ${firstName(call.callerName) || "They"} can suggest one. Thanks.`,
      hangup: true
    };
  }

  if (context.phase === "asked_location" && hasUsefulGenericAnswer(message)) {
    context.completed = true;
    context.capturedAnswer = combineAnswers(context.capturedAnswer, rawMessage);
    return {
      text: "Got it, I will pass that along. Thanks.",
      hangup: true
    };
  }

  if (hasUsefulGenericAnswer(message)) {
    if (needsObjectiveFollowup(message, context)) {
      context.phase = "asked_specific_time";
      context.capturedAnswer = rawMessage;
      return short(objectiveFollowup(call, message));
    }
    if (needsAvailabilityFollowup(message, context)) {
      context.phase = "asked_followup";
      context.capturedAnswer = rawMessage;
      return short(call.dateHint ? "What time works?" : "What day or time works?");
    }
    if (needsLocationFollowup(message, context)) {
      context.phase = "asked_location";
      context.capturedAnswer = rawMessage;
      return short(`Do you have a place in mind, or should ${firstName(call.callerName) || "they"} suggest one?`);
    }
    context.completed = true;
    context.capturedAnswer = rawMessage;
    return {
      text: "Got it, I will pass that along. Thanks.",
      hangup: true
    };
  }

  if (context.phase === "opened" || context.turns === 1) {
    context.phase = "asked_goal";
    return short(call.question || goalQuestion(call));
  }

  context.completed = true;
  context.capturedAnswer = rawMessage;
  return {
    text: "Got it, I will pass that along. Thanks.",
    hangup: true
  };
}

function combineAnswers(previous, next) {
  return [previous, next]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ");
}

export function summarizeCallState(body) {
  const context = getContext(body);
  return {
    kind: context.kind,
    taskId: context.appointment?.taskId || context.call?.taskId || null,
    taskTitle: context.taskTitle || context.appointment?.taskTitle || context.call?.taskTitle || null,
    to: context.to,
    phase: context.phase,
    offeredTime: context.offeredTime,
    capturedAnswer: context.capturedAnswer || null,
    completed: context.completed,
    turns: context.turns
  };
}

function getContext(body) {
  const callId = body.data?.callId || body.data?.call_id || body.data?.conversationId;
  const phones = [body.data?.from, body.data?.to].filter(Boolean);
  if (callId && calls.has(callId)) return calls.get(callId);
  for (const phone of phones) {
    if (calls.has(phone)) return calls.get(phone);
  }

  const context = {
    kind: "appointment",
    callId,
    to: phones[0] || null,
    appointment: DEFAULT_APPOINTMENT,
    phase: "opened",
    offeredTime: null,
    turns: 0,
    completed: false
  };

  if (callId) calls.set(callId, context);
  for (const phone of phones) calls.set(phone, context);
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

function asksWhoIsCalling(text) {
  return /who.*calling|who is this|what is this|why.*calling|who are you|what.*about/.test(text);
}

function asksWhatTime(text) {
  return /\bwhat time\b|when exactly|what works/i.test(text);
}

function asksForSuggestion(text) {
  return /what.*suggest|where.*go|what place|which place|you suggest|recommend/i.test(text);
}

function isOffTask(text) {
  return /what are you building|what.*building|hackathon|startup|software|demo|agent|ai|sponsor|browser use|yc\b|recipe|sponge cake|how to make(?!.*appointment)|how do i cook/.test(text);
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

function isSoftPositive(text) {
  return /sure|sounds good|i'll do that|i can do that|okay|ok/.test(text);
}

function strongConfirmation(text) {
  return /\byes\b|confirmed|booked|scheduled|all set|got .*down|on (my|the) calendar|you are set|you're set/.test(text);
}

function noAvailability(text) {
  return /\b(no|none|nothing)\b|no availability|no more appointments|fully booked|not available|can't|cannot|no slots|no appointments/.test(text);
}

function requiresExternalBooking(text) {
  return /website|web site|online|portal|book it yourself|go book|use the site|through the site|can't book.*phone|cannot book.*phone|not by phone/.test(text);
}

function appointmentImpossible(text) {
  return /not possible|that's not possible|business is closed|office is closed|closed|no more appointments|don't have any more|cannot schedule|can't schedule|not taking appointments/.test(text);
}

function hasUsefulGenericAnswer(text) {
  return /\b(free|available|can|can't|cannot|busy|tonight|tomorrow|today|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|later|after work|sometime|pm|am|\d{1,2}(:\d{2})?|place|location|restaurant|cafe|coffee|bar|park|anywhere|wherever|you pick|suggest)\b/i.test(text);
}

function needsAvailabilityFollowup(text, context) {
  if (["asked_followup", "asked_specific_time"].includes(context.phase)) return false;
  if (!/\b(free|available|can|busy)\b/i.test(text)) return false;
  if (context.call?.dateHint && /\b(yes|yeah|yep|sure|works|free|available|can)\b/i.test(text)) {
    return !/\b(morning|afternoon|evening|\d{1,2}(:\d{2})?\s*(am|pm)?)\b/i.test(text);
  }
  return !/\b(tonight|tomorrow|today|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|\d{1,2}(:\d{2})?\s*(am|pm)?)\b/i.test(text);
}

function needsObjectiveFollowup(text, context) {
  if (context.phase === "asked_specific_time") return false;
  if (!/scheduling|time|time window|timing|act on/i.test(context.call?.successGuidance || "")) return false;
  if (hasSpecificTime(text)) return false;
  return hasBroadTimeOnly(text) || /\b(yes|yeah|yep|sure|maybe|later|after work|sometime)\b/i.test(text);
}

function objectiveFollowup(call, text) {
  if (/\bevening\b/i.test(text)) return "What time in the evening works?";
  if (/\bafternoon\b/i.test(text)) return "What time in the afternoon works?";
  if (/after work/i.test(text)) return "What time after work should I tell them?";
  return call.dateHint ? `What time ${call.dateHint} should I tell them?` : "What specific time should I tell them?";
}

function needsLocationFollowup(text, context) {
  if (!context.call?.locationHelpful) return false;
  if (context.phase === "asked_location") return false;
  if (!hasSpecificTime(text)) return false;
  if (context.turns > 3) return false;
  return !hasLocationSignal(text);
}

function hasLocationSignal(text) {
  return /\b(place|location|restaurant|cafe|coffee|bar|park|home|office|downtown|mission|soma|anywhere|wherever|you pick|suggest|near|at\s+\w+)/i.test(text);
}

function hasSpecificTime(text) {
  return /\b(?:around\s+|about\s+|after\s+|before\s+|by\s+|at\s+|between\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i.test(text);
}

function hasBroadTimeOnly(text) {
  return /\b(morning|afternoon|evening|night|later|after work)\b/i.test(text);
}

function goalQuestion(call) {
  const goal = String(call.goal || "ask a quick question").trim();
  const normalized = toSecondPerson(goal).replace(/[.?!]+$/, "");
  if (/^(ask|find out|see|check)\b/i.test(normalized)) {
    return capitalizeSentence(`${normalized.replace(/^ask\s+(him|her|them)\s+/i, "").replace(/^ask\s+/i, "")}?`);
  }
  return capitalizeSentence(`${normalized}?`);
}

function firstName(value) {
  return String(value || "").trim().split(/\s+/)[0] || "";
}

function toSecondPerson(value) {
  return String(value || "")
    .replace(/\bhe's\b/gi, "you're")
    .replace(/\bshe's\b/gi, "you're")
    .replace(/\bthey're\b/gi, "you're")
    .replace(/\bhis\b/gi, "your")
    .replace(/\bher\b/gi, "your")
    .replace(/\btheir\b/gi, "your")
    .replace(/\bhim\b/gi, "you")
    .replace(/\bthem\b/gi, "you")
    .replace(/\bwhen you're\b/gi, "when are you");
}

function capitalizeSentence(value) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 1).toUpperCase() + text.slice(1) : text;
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
