const TOOL_CATALOG = {
  browserUse: "Research websites, inspect public pages, fill reversible forms, prepare carts or drafts, and stop before irreversible submission.",
  agentPhone: "Make outbound calls and collect spoken answers. Never make commitments beyond the user's instruction.",
  agentMail: "Send or receive email. Drafting is allowed; sending needs explicit approval unless the user directly asked to send.",
  supermemory: "Recall and save durable user/task context.",
  moss: "Retrieve fast factual/legal/policy snippets for calls and decisions.",
  sponge: "Prepare wallet/card payments only after explicit user payment approval.",
  stripe: "Collect success fees or user payments only after explicit confirmation."
};

export function injectWorkflow({ task, user, knownWorkflows = [] }) {
  const title = String(task?.title || "");
  const signals = readSignals(title);
  const tools = chooseTools(signals);
  const approvalGates = chooseApprovalGates(signals);
  const agents = chooseAgents(tools);
  const label = chooseLabel(signals);
  const browserCapability = tools.includes("browserUse") ? "injected-workflow" : null;
  const injected = {
    id: `injected.${slug(label)}`,
    type: "injected_workflow",
    label,
    tools,
    fallbackTools: chooseFallbackTools(tools),
    approvalGates,
    agents,
    browserCapability,
    model: "bu-mini",
    maxSteps: signals.needsDeepResearch ? 14 : 10,
    maxRuntimeMs: signals.needsDeepResearch ? 120000 : 90000,
    maxCostUsd: signals.needsDeepResearch ? 0.4 : 0.25,
    showLive: false,
    requiresClarification: signals.requiresClarification,
    clarificationQuestion: signals.clarificationQuestion,
    outputSchema: injectedOutputSchema(),
    browserPrompt: ({ task: promptTask, user: promptUser }) => buildInjectedBrowserPrompt({
      task: promptTask,
      user: promptUser,
      tools,
      approvalGates,
      signals,
      knownWorkflows
    })
  };

  return {
    mode: "injected",
    provider: "WorkflowInjectorAgent",
    result: `Injected ${label} using ${tools.join(", ")}.`,
    summary: `${label}: ${tools.join(", ")} with approval gates ${approvalGates.join(", ") || "none"}.`,
    confidence: signals.confidence,
    reason: signals.reason,
    requiresClarification: signals.requiresClarification,
    clarificationQuestion: signals.clarificationQuestion,
    template: injected
  };
}

function readSignals(title) {
  const text = title.toLowerCase();
  const wantsResearch = /\b(find|look up|search|research|compare|check|see if|figure out|options?|recommend)\b/.test(text);
  const wantsMessage = /\b(email|message|reply|draft|send note|write to)\b/.test(text);
  const wantsCall = /\b(call|phone|dial|ask by phone)\b/.test(text) || hasPhone(text);
  const wantsForm = /\b(form|application|portal|submit|fill|request)\b/.test(text);
  const wantsPurchase = /\b(order|buy|purchase|checkout|cart|pay|payment|delivery)\b/.test(text);
  const wantsBooking = /\b(book|schedule|reserve|appointment|reservation)\b/.test(text);
  const needsDeepResearch = /\b(compare|research|best|options?|recommend|find)\b/.test(text);
  const irreversible = wantsPurchase || wantsBooking || wantsForm || /\b(send|submit|confirm|authorize)\b/.test(text);
  const ambiguousPersonalReference = /\bmy\s+(gym|bank|insurance|landlord|building manager|doctor|dentist|school|apartment|utility|provider|account)\b/.test(text) && !hasSpecificTarget(title);
  const requiresClarification = ambiguousPersonalReference;
  const clarificationQuestion = ambiguousPersonalReference
    ? "Which provider or contact should GOFER use for this request? Share the name, website, phone number, or email."
    : null;
  const confidence = requiresClarification
    ? "needs_clarification"
    : wantsResearch || wantsMessage || wantsCall || wantsForm || wantsPurchase || wantsBooking ? "medium" : "low";
  const reason = confidence === "medium"
    ? "Request did not match a fixed template but contains actionable tool signals."
    : confidence === "needs_clarification"
      ? "Request references a personal provider/contact that GOFER cannot identify yet."
    : "Request is foreign to fixed templates; using a conservative research-first workflow.";
  return {
    wantsResearch,
    wantsMessage,
    wantsCall,
    wantsForm,
    wantsPurchase,
    wantsBooking,
    needsDeepResearch,
    irreversible,
    requiresClarification,
    clarificationQuestion,
    confidence,
    reason
  };
}

function chooseTools(signals) {
  const tools = new Set(["supermemory"]);
  if (signals.wantsResearch || signals.wantsForm || signals.wantsPurchase || signals.wantsBooking || !signals.wantsCall) {
    tools.add("browserUse");
  }
  if (signals.wantsCall) tools.add("agentPhone");
  if (signals.wantsMessage) tools.add("agentMail");
  if (signals.wantsPurchase) tools.add("sponge");
  if (signals.wantsBooking || signals.wantsForm) tools.add("agentMail");
  return [...tools];
}

function chooseAgents(tools) {
  const agents = new Set(["workflow-injector", "memory-legal"]);
  if (tools.includes("browserUse")) agents.add("browser-recon");
  if (tools.includes("agentPhone")) agents.add("phone-booking");
  if (tools.includes("agentMail")) agents.add("email-application");
  if (tools.includes("sponge") || tools.includes("stripe")) agents.add("payment");
  return [...agents];
}

function chooseApprovalGates(signals) {
  const gates = new Set(["external_commitment"]);
  if (signals.wantsPurchase) {
    gates.add("cart_build");
    gates.add("payment");
    gates.add("order_submission");
  }
  if (signals.wantsBooking) gates.add("final_booking");
  if (signals.wantsForm) gates.add("submit_sensitive_form");
  if (signals.wantsMessage) gates.add("send_message");
  return [...gates];
}

function chooseFallbackTools(tools) {
  const fallback = [];
  if (tools.includes("browserUse")) fallback.push("agentPhone", "agentMail");
  if (tools.includes("agentPhone")) fallback.push("agentMail");
  return [...new Set(fallback)].filter((tool) => !tools.includes(tool));
}

function chooseLabel(signals) {
  if (signals.wantsPurchase) return "Injected purchase prep";
  if (signals.wantsBooking) return "Injected booking prep";
  if (signals.wantsForm) return "Injected form prep";
  if (signals.wantsCall) return "Injected phone workflow";
  if (signals.wantsMessage) return "Injected message workflow";
  return "Injected research workflow";
}

function buildInjectedBrowserPrompt({ task, user, tools, approvalGates, signals, knownWorkflows }) {
  return [
    "You are GOFER's BrowserReconAgent executing a workflow generated by WorkflowInjectorAgent.",
    "The fixed workflow templates did not confidently match this request, so use a conservative research-first plan.",
    `User request: ${task.title}`,
    `Known user context: ${JSON.stringify(redactUser(user))}`,
    `Available sponsor tools in this injected workflow: ${tools.map((tool) => `${tool}: ${TOOL_CATALOG[tool] || tool}`).join(" | ")}`,
    `Approval gates: ${approvalGates.join(", ") || "none"}.`,
    knownWorkflows?.length ? `Nearby fixed workflows for reference only: ${knownWorkflows.map((workflow) => workflow.id).slice(0, 8).join(", ")}.` : "",
    "Do only reversible research, comparison, drafting, or preparation.",
    "Never checkout, pay, submit, confirm, book, create an account, send a message, or authorize anything without explicit user confirmation.",
    "If the next useful step requires phone, email, payment, login, OAuth, profile state, personal data, or final confirmation, stop and set approval_required=true.",
    "If the request is ambiguous, return a concrete clarification question in next_action instead of guessing.",
    signals.wantsPurchase ? "For purchase/order requests, return options or a prepared cart state only; payment and order submission must remain pending." : "",
    signals.wantsBooking ? "For booking/scheduling requests, do not invent date, time, party size, recipient, or provider details." : "",
    "Return concise JSON with: status, approval_required, completed_steps, findings, recommended_next_step, next_action, blockers."
  ].filter(Boolean).join(" ");
}

function injectedOutputSchema() {
  return {
    type: "object",
    properties: {
      status: { type: "string" },
      approval_required: { type: "boolean" },
      completed_steps: {
        type: "array",
        items: { type: "string" }
      },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            detail: { type: "string" },
            source_or_path: { type: "string" }
          }
        }
      },
      recommended_next_step: { type: "string" },
      next_action: { type: "string" },
      blockers: {
        anyOf: [
          { type: "string" },
          {
            type: "array",
            items: { type: "string" }
          }
        ]
      }
    },
    required: ["status", "approval_required", "next_action"]
  };
}

function redactUser(user = {}) {
  return {
    name: user.name,
    address: user.address,
    zip: user.zip,
    preferences: user.preferences
  };
}

function hasPhone(text) {
  return /(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/.test(text);
}

function hasSpecificTarget(text) {
  return /https?:\/\/|www\.|@[a-z0-9.-]+|\b(?:called|named)\s+[A-Z0-9]|(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/.test(text);
}

function slug(value) {
  return String(value || "workflow")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "workflow";
}
