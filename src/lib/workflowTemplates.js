export const WORKFLOW_TEMPLATES = [
  {
    id: "reservation.verify_availability",
    type: "restaurant_reservation",
    label: "Reservation availability check",
    match: /(verify live availability|prepare booking|check availability|confirm reservation path)/i,
    tools: ["browserUse", "agentPhone", "agentMail", "supermemory"],
    approvalGates: ["final_booking", "payment_or_deposit"],
    agents: ["browser-recon", "phone-booking", "email-application", "memory-legal"],
    browserCapability: "reservation-availability",
    model: "bu-mini",
    maxSteps: 18,
    maxRuntimeMs: 150000,
    maxCostUsd: 0.45,
    showLive: false,
    outputSchema: reservationOutputSchema(),
    browserPrompt: ({ task, user }) => [
      "You are GOFER's BrowserReconAgent. Verify the booking path for the specific restaurant in this approved follow-up.",
      "You may open the restaurant website, OpenTable, Resy, Toast, or another official reservation page if needed.",
      "Global payment rule: any payment, card hold, deposit, authorization, wallet charge, or fee requires explicit user confirmation first.",
      "Do not finalize the reservation, submit payment, enter card details, create an account, or click a final confirmation button.",
      `Approved follow-up: ${task.title}`,
      `User home/base context: ${user.address || user.zip || "unknown"}.`,
      "Look for availability around the requested date/time and party size.",
      "If live availability is visible, return it. If login, deposit, phone-only booking, or final confirmation is required, stop and mark approval_required=true.",
      "If online availability cannot be verified, return the best next action: call restaurant, email, or ask user for approval to proceed on the booking site.",
      "Return concise JSON with: status, approval_required, recommended_candidate, candidates, next_action, blockers."
    ].join(" ")
  },
  {
    id: "reservation.find_and_book",
    type: "restaurant_reservation",
    label: "Restaurant reservation",
    match: /(restaurant|dinner|reservation|book.*table|reserve.*table|chinese|italian|sushi|mexican|team dinner)/i,
    tools: ["browserUse", "agentPhone", "agentMail", "supermemory"],
    approvalGates: ["final_booking", "payment_or_deposit"],
    agents: ["browser-recon", "phone-booking", "email-application", "memory-legal"],
    browserCapability: "reservation-discovery",
    model: "bu-mini",
    maxSteps: 14,
    maxRuntimeMs: 100000,
    maxCostUsd: 0.25,
    showLive: false,
    outputSchema: reservationOutputSchema(),
    browserPrompt: ({ task, user }) => [
      "You are GOFER's BrowserReconAgent. Use Browser Use web search as a research tool. Do not show the browser; just return the summary.",
      "Do not make a final booking.",
      `User request: ${task.title}`,
      `User home/base context: ${user.address || user.zip || "unknown"}.`,
      "Extract constraints: cuisine, neighborhood/address, party size, date, time window, price preference, occasion.",
      "Use at most two web searches. Suggested searches: Chinese restaurant near 560 20th St San Francisco team dinner; Chinese restaurant Dogpatch Mission Bay San Francisco reservations.",
      "Do not open OpenTable, Resy, Yelp, Google Maps, or restaurant pages unless the search result snippet already exposes the needed answer. Do not navigate into booking pages.",
      "Find 3 restaurant candidates that match the constraints.",
      "Prioritize: close to 560 20th St, Chinese cuisine, not too expensive, good for a 3-person team dinner, likely reservation/contact path.",
      "For each candidate return name, neighborhood/address if visible, estimated price level if visible, why it fits, likely booking channel from snippets, phone/website only if visible in snippets.",
      "If live availability is unknown, say availability_not_verified. Do not treat that as failure.",
      "Return concise JSON with: status, approval_required, recommended_candidate, candidates, next_action, blockers."
    ].join(" ")
  },
  {
    id: "browser.product_options",
    type: "product_discovery",
    label: "Product options",
    match: /(?=.*\b(order|buy|send|shop|look for|find|get)\b)(?=.*\b(flower|flowers|gift|target|best options|options)\b)(?=.*\b(don't checkout|do not checkout|no checkout|without checkout|just give me|options|best options)\b)/i,
    tools: ["browserUse", "supermemory", "agentMail"],
    approvalGates: ["cart_build", "payment", "order_submission"],
    agents: ["browser-recon", "memory-legal"],
    browserCapability: "product-discovery",
    model: "bu-mini",
    maxSteps: 12,
    maxRuntimeMs: 100000,
    maxCostUsd: 0.3,
    showLive: false,
    outputSchema: actionWorkflowSchema({
      merchant: { type: "string" },
      recommended_option: { type: "string" },
      options: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            price: { type: "string" },
            why_it_fits: { type: "string" },
            url_or_path: { type: "string" },
            availability: { type: "string" }
          }
        }
      }
    }),
    browserPrompt: ({ task }) => [
      "You are GOFER's BrowserReconAgent. Research product options only. Do not add anything to cart unless the user explicitly asked for cart building.",
      "Global payment rule: any payment, card hold, deposit, authorization, wallet charge, or fee requires explicit user confirmation first.",
      `User request: ${task.title}`,
      "If a merchant is named, start there. For Target flower requests, search Target for flower bouquets, arrangements, plants, or giftable floral items that fit the recipient.",
      "Find 3 to 5 strong options. Prefer items with visible price, availability, delivery or pickup path, and a useful product page.",
      "Do not checkout, do not enter payment, do not place an order, and do not click final purchase buttons.",
      "Return approval_required=true because the user must choose an option before GOFER builds a cart.",
      "Return JSON with: status, approval_required, merchant, recommended_option, options, next_action, blockers."
    ].join(" ")
  },
  {
    id: "browser.purchase_until_checkout",
    type: "purchase",
    label: "Browser checkout",
    match: /(order|buy|send).*(flower|cake|gift|delivery)|flowers|birthday|doordash|cart|checkout/i,
    tools: ["browserUse", "sponge", "supermemory", "agentMail"],
    approvalGates: ["payment", "order_submission"],
    agents: ["browser-recon", "payment", "email-application", "memory-legal"],
    browserCapability: "purchase-until-checkout",
    model: "bu-mini",
    maxSteps: 14,
    maxRuntimeMs: 120000,
    maxCostUsd: 0.35,
    showLive: false,
    outputSchema: actionWorkflowSchema({
      merchant: { type: "string" },
      selected_items: {
        type: "array",
        items: { type: "string" }
      },
      subtotal: { type: "string" },
      checkout_state: { type: "string" }
    }),
    browserPrompt: ({ task }) => [
      "You are GOFER's BrowserReconAgent. Build a purchase cart but do not submit payment or final order.",
      "Global payment rule: any payment, card hold, deposit, authorization, wallet charge, or fee requires explicit user confirmation first.",
      `User request: ${task.title}`,
      "Find the requested product/service, select reasonable defaults, add to cart, and stop at checkout review.",
      "Never claim an order was placed unless the site itself shows a completed order confirmation after explicit approval. In this workflow there is no such approval, so stop before that point.",
      "If login, OAuth, payment, card, address confirmation, or final order submission is required, stop and return approval_required=true.",
      "Return JSON with: status, approval_required, merchant, selected_items, subtotal, checkout_state, next_action, blockers."
    ].join(" ")
  },
  {
    id: "browser.fill_form",
    type: "form_fill",
    label: "Form fill",
    match: /(fill|submit|complete).*(form|application|portal|request)/i,
    tools: ["browserUse", "agentMail", "supermemory"],
    approvalGates: ["submit_sensitive_form"],
    agents: ["browser-recon", "email-application", "memory-legal"],
    browserCapability: "form-fill",
    model: "bu-mini",
    maxSteps: 12,
    maxRuntimeMs: 90000,
    maxCostUsd: 0.3,
    showLive: false,
    outputSchema: actionWorkflowSchema({
      form_name: { type: "string" },
      fields_completed: {
        type: "array",
        items: { type: "string" }
      },
      fields_missing: {
        type: "array",
        items: { type: "string" }
      }
    }),
    browserPrompt: ({ task, user }) => [
      "You are GOFER's BrowserReconAgent. Fill the requested form using known user details, but stop before submitting sensitive or irreversible data.",
      "Global payment rule: any payment, card hold, deposit, authorization, wallet charge, or fee requires explicit user confirmation first.",
      `User request: ${task.title}`,
      `Known user profile: ${JSON.stringify(redactUserForPrompt(user))}`,
      "If the form asks for payment, SSN, government ID, medical secrets, OAuth, or irreversible submission, stop and return approval_required=true.",
      "Return JSON with: status, approval_required, form_name, fields_completed, fields_missing, next_action, blockers."
    ].join(" ")
  },
  {
    id: "phone.book_appointment",
    type: "appointment_booking",
    label: "Phone appointment",
    match: /(book|schedule).*(dentist|doctor|haircut|appointment|cleaning)/i,
    tools: ["browserUse", "moss", "agentPhone", "supermemory"],
    approvalGates: ["confirm_time"],
    agents: ["phone-booking", "memory-legal"],
    browserCapability: null
  },
  {
    id: "billing.dispute_charge",
    type: "billing_dispute",
    label: "Authenticated portal",
    match: /(dispute|refund|overcharge|charge|bill|billing)/i,
    tools: ["browserUse", "agentMail", "supermemory"],
    approvalGates: ["submit_dispute"],
    agents: ["browser-recon", "email-application", "memory-legal"],
    browserCapability: "billing-dispute",
    model: "bu-mini",
    maxSteps: 14,
    maxRuntimeMs: 120000,
    maxCostUsd: 0.35,
    showLive: false,
    outputSchema: actionWorkflowSchema({
      portal_or_company: { type: "string" },
      disputed_amount: { type: "string" },
      evidence_found: {
        type: "array",
        items: { type: "string" }
      },
      draft_dispute: { type: "string" }
    }),
    browserPrompt: ({ task, user }) => [
      "You are GOFER's BrowserReconAgent. Prepare a billing dispute, but do not submit it.",
      "Global payment rule: any payment, card hold, deposit, authorization, wallet charge, or fee requires explicit user confirmation first.",
      `User request: ${task.title}`,
      `Known user context: ${JSON.stringify(redactUserForPrompt(user))}`,
      "Find the relevant bill/charge if accessible. Identify the disputed amount and draft the dispute language.",
      "Do not click a final submit, file dispute, send message, payment, or confirmation button.",
      "If login, OAuth, account verification, or final submission is required, stop and return approval_required=true.",
      "Return JSON with: status, approval_required, portal_or_company, disputed_amount, evidence_found, draft_dispute, next_action, blockers."
    ].join(" ")
  }
];

export function detectWorkflow(text) {
  return WORKFLOW_TEMPLATES.find((template) => template.match.test(text)) || {
    id: "general.errand",
    type: "general_errand",
    label: "General errand",
    tools: ["browserUse", "agentPhone", "supermemory"],
    approvalGates: ["external_commitment"],
    agents: ["browser-recon", "phone-booking", "memory-legal"],
    browserCapability: "general",
    model: "bu-mini",
    maxSteps: 10,
    maxRuntimeMs: 90000,
    maxCostUsd: 0.25,
    outputSchema: actionWorkflowSchema({
      completed_steps: {
        type: "array",
        items: { type: "string" }
      }
    }),
    browserPrompt: ({ task }) => [
      "You are GOFER's BrowserReconAgent. Complete the reversible research/action steps for this errand.",
      "Global payment rule: any payment, card hold, deposit, authorization, wallet charge, or fee requires explicit user confirmation first.",
      `User request: ${task.title}`,
      "Do not make payments, submit final orders, create accounts, or make irreversible commitments.",
      "Return JSON with: status, approval_required, completed_steps, next_action, blockers."
    ].join(" ")
  };
}

export function getWorkflowTemplate(id) {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id) || detectWorkflow("");
}

export function buildBrowserPrompt(template, task, user) {
  if (template.browserPrompt) return template.browserPrompt({ task, user });
  return [
    `User request: ${task.title}`,
    "Perform the browser portion of this task. Stop before irreversible action.",
    "Return concise JSON with status, approval_required, next_action, and blockers."
  ].join(" ");
}

export function workflowCatalog() {
  return WORKFLOW_TEMPLATES.map((template) => ({
    id: template.id,
    type: template.type,
    label: template.label,
    tools: template.tools,
    agents: template.agents,
    approvalGates: template.approvalGates
  }));
}

function redactUserForPrompt(user) {
  return {
    name: user.name,
    address: user.address,
    zip: user.zip,
    preferences: user.preferences,
    insurance: user.insurance ? {
      dentalProvider: user.insurance.dentalProvider,
      groupNumber: user.insurance.groupNumber
    } : null
  };
}

function reservationOutputSchema() {
  return {
    type: "object",
    properties: {
      status: { type: "string" },
      approval_required: { type: "boolean" },
      recommended_candidate: {
        anyOf: [
          { type: "string" },
          {
            type: "object",
            properties: {
              name: { type: "string" },
              reason: { type: "string" }
            }
          }
        ]
      },
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            neighborhood_address: { type: "string" },
            estimated_price_level: { type: "string" },
            why_it_fits: { type: "string" },
            likely_booking_channel: { type: "string" },
            contact_info: { type: "string" },
            availability: { type: "string" }
          }
        }
      },
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
    required: ["status", "approval_required", "recommended_candidate", "candidates", "next_action"]
  };
}

function actionWorkflowSchema(extraProperties = {}) {
  return {
    type: "object",
    properties: {
      status: { type: "string" },
      approval_required: { type: "boolean" },
      next_action: { type: "string" },
      blockers: {
        anyOf: [
          { type: "string" },
          {
            type: "array",
            items: { type: "string" }
          }
        ]
      },
      ...extraProperties
    },
    required: ["status", "approval_required", "next_action"]
  };
}
