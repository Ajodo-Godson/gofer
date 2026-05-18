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
    maxSteps: 20,
    maxRuntimeMs: 100000,
    maxCostUsd: 0.45,
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
      "You are GOFER's BrowserReconAgent. Research product options only. Return useful options quickly.",
      "Global payment rule: any payment, card hold, deposit, authorization, wallet charge, or fee requires explicit user confirmation first.",
      `User request: ${task.title}`,
      "Use web search as the primary source. Prefer search snippets and search result cards over navigating heavy retailer pages. Do not browse deeply.",
      "Use at most two searches. If a merchant is named, search for that merchant plus the product category. Example pattern: site:target.com flowers bouquet gift mom.",
      "Do not open cart pages, checkout pages, sign-in pages, account pages, or location-gated flows.",
      "Infer the product category, recipient, occasion, budget, delivery/pickup needs, and quality signals from the user request.",
      "Find 3 to 5 strong options. Prefer items with visible price, availability, delivery or pickup path, and a useful product page.",
      "If the retailer site is slow, blocked, or requires location/account state, do not keep clicking. Return the best options discovered from search snippets and mark availability as availability_not_verified.",
      "Do not checkout, do not enter payment, do not place an order, and do not click final purchase buttons.",
      "Return approval_required=true because the user must choose an option before GOFER builds a cart.",
      "Return JSON with: status, approval_required, merchant, recommended_option, options, next_action, blockers."
    ].join(" ")
  },
  {
    id: "food.order_options",
    type: "product_discovery",
    label: "Food order options",
    match: /(doordash|order food|food order|takeout|delivery|menu|check.*restaurant)/i,
    tools: ["browserUse", "supermemory", "agentMail"],
    approvalGates: ["cart_build", "payment", "order_submission"],
    agents: ["browser-recon", "memory-legal"],
    browserCapability: "food-order-discovery",
    model: "bu-mini",
    maxSteps: 20,
    maxRuntimeMs: 180000,
    maxCostUsd: 0.5,
    showLive: true,
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
    browserPrompt: ({ task, user }) => [
      "You are GOFER's BrowserReconAgent. Research food ordering options only.",
      "This is not a restaurant reservation task unless the user explicitly asks to reserve or book a table.",
      "Global payment rule: any payment, card hold, deposit, authorization, wallet charge, tip, delivery fee, or order submission requires explicit user confirmation first.",
      `User request: ${task.title}`,
      `User base/location context: ${user.address || user.zip || "unknown"}.`,
      "If the user explicitly mentions DoorDash, open https://www.doordash.com/ directly and use DoorDash visible search/results/menu controls. Do not use Google, DuckDuckGo, Yelp, Maps, or broad web search for explicit DoorDash requests.",
      "If the user explicitly mentions UberEats or Uber Eats, open https://www.ubereats.com/ directly. If UberEats shows a delivery address prompt, type the user base/location context address into the address field and confirm it before searching. Then use UberEats visible search/results/menu controls to find the restaurant. Do not use broad web search for explicit UberEats requests.",
      "For non-DoorDash, non-UberEats food requests, use the fastest direct source available: the restaurant ordering page, a delivery-style result page, or search snippets if no direct merchant is named.",
      "Do not add to cart, open checkout, enter delivery/payment details, or place an order.",
      "If a restaurant is named, find that restaurant's ordering/menu options and likely delivery or pickup channel.",
      "If DoorDash asks for location, use the user base/location context. If it asks for login/OAuth/verification/CAPTCHA, stop and return approval_required=true with the exact blocker.",
      "Return 3 to 5 orderable menu or restaurant options. Include item or restaurant name, likely price if visible, why it fits, ordering channel/path, and availability if visible.",
      "If availability or delivery status is not visible, mark availability_not_verified and still return useful options.",
      "Return approval_required=true because the user must choose an option before GOFER builds a cart.",
      "Return JSON with: status, approval_required, merchant, recommended_option, options, next_action, blockers."
    ].join(" ")
  },
  {
    id: "food.doordash_cart_build",
    type: "purchase",
    label: "DoorDash cart build",
    match: /(doordash).*(cart|checkout|approved synced Browser Use profile|add.*cart|build.*cart)|(cart|checkout|add.*cart|build.*cart).*(doordash)/i,
    tools: ["browserUse", "sponge", "supermemory", "agentMail"],
    approvalGates: ["payment", "order_submission"],
    agents: ["browser-recon", "payment", "email-application", "memory-legal"],
    browserCapability: "doordash-cart-build",
    model: "bu-mini",
    maxSteps: 20,
    maxRuntimeMs: 180000,
    maxCostUsd: 0.75,
    showLive: true,
    outputSchema: actionWorkflowSchema({
      merchant: { type: "string" },
      selected_items: {
        type: "array",
        items: { type: "string" }
      },
      subtotal: { type: "string" },
      checkout_state: { type: "string" },
      auth_required: { type: "boolean" }
    }),
    browserPrompt: ({ task, user }) => [
      "You are GOFER's BrowserReconAgent. Build a DoorDash cart only. This is not restaurant discovery and not a table reservation.",
      "Use the approved synced Browser Use profile if available. Do not start a new login flow unless the existing session has expired.",
      "Global payment rule: any payment, card hold, deposit, authorization, wallet charge, tip confirmation, or order submission requires explicit user confirmation first.",
      `User request: ${task.title}`,
      `Delivery/location context if DoorDash asks: ${user.address || user.zip || "680 Folsom St, San Francisco, CA"}.`,
      doordashStoreHint(task.title),
      doordashItemHint(task.title),
      "Extract the restaurant name from the request. If a restaurant is named, search DoorDash for that exact restaurant name first.",
      "If an exact DoorDash store URL is provided above, open that exact URL first and do not search for the restaurant.",
      "If no exact store URL is provided, open https://www.doordash.com/ directly. Do not use broad web search and do not browse unrelated restaurants.",
      "If DoorDash asks for an address, enter the provided delivery/location context.",
      "If the named restaurant is not found, return approval_required=true with blocker='restaurant_not_found' and stop.",
      "Select one normal entree or popular item from the named restaurant. If a preferred item target is provided above and visible, use it.",
      "Use default required options. Do not add extras unless required to add the item.",
      "Add exactly one item to the cart, then stop at cart or checkout review.",
      "If item clicks do not open a customization/add-item dialog after two attempts, stop and return approval_required=true with blocker='menu_item_not_clickable' and the item you tried.",
      "If OAuth, phone verification, CAPTCHA, account creation, payment, card entry, or final place-order confirmation appears, stop immediately and return approval_required=true.",
      "Return JSON with: status, approval_required, auth_required, merchant, selected_items, subtotal, checkout_state, next_action, blockers."
    ].join(" ")
  },
  {
    id: "food.ubereats_cart_build",
    type: "purchase",
    label: "UberEats cart build",
    match: /(ubereats|uber\s+eats|uber).*(cart|checkout|add.*cart|build.*cart)|(cart|checkout|add.*cart|build.*cart).*(ubereats|uber\s+eats)/i,
    tools: ["browserUse", "sponge", "supermemory", "agentMail"],
    approvalGates: ["payment", "order_submission"],
    agents: ["browser-recon", "payment", "email-application", "memory-legal"],
    browserCapability: "ubereats-cart-build",
    model: "bu-mini",
    maxSteps: 20,
    maxRuntimeMs: 180000,
    maxCostUsd: 0.75,
    showLive: true,
    outputSchema: actionWorkflowSchema({
      merchant: { type: "string" },
      selected_items: {
        type: "array",
        items: { type: "string" }
      },
      subtotal: { type: "string" },
      checkout_state: { type: "string" },
      auth_required: { type: "boolean" }
    }),
    browserPrompt: ({ task, user }) => [
      "You are GOFER's BrowserReconAgent. Build a UberEats cart only. This is not restaurant discovery and not a table reservation.",
      "Use the approved synced Browser Use profile if available. Do not start a new login flow unless the existing session has expired.",
      "Global payment rule: any payment, card hold, deposit, authorization, wallet charge, tip confirmation, or order submission requires explicit user confirmation first.",
      `User request: ${task.title}`,
      `Delivery/location context if UberEats asks: ${user.address || user.zip || "680 Folsom St, San Francisco, CA"}.`,
      "Open https://www.ubereats.com/ directly. Do not use broad web search.",
      "Extract the restaurant name and item from the user request.",
      "If UberEats asks for a delivery address, enter the provided location context.",
      "Search for the named restaurant on UberEats. Navigate to its menu.",
      "Find the specified item. If customization is required, choose the first reasonable default options.",
      "Add exactly one item to the cart, then stop at cart or checkout review before payment or order submission.",
      "If item clicks do not open a customization dialog after two attempts, stop and return approval_required=true with the item you tried.",
      "If OAuth, phone verification, CAPTCHA, account creation, payment, card entry, or final place-order appears, stop immediately and return approval_required=true.",
      "Return JSON with: status, approval_required, auth_required, merchant, selected_items, subtotal, checkout_state, next_action, blockers."
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
    match: /(?:book|schedule|call).*(dentist|doctor|haircut|appointment|cleaning)/i,
    tools: ["browserUse", "moss", "agentPhone", "supermemory"],
    approvalGates: ["confirm_time"],
    agents: ["phone-booking", "memory-legal"],
    browserCapability: null
  },
  {
    id: "phone.general_call",
    type: "general_phone_call",
    label: "Phone call",
    match: /\bcall\b.*(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/i,
    tools: ["agentPhone", "supermemory"],
    approvalGates: ["external_commitment"],
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
  const id = inferWorkflowId(text);
  return WORKFLOW_TEMPLATES.find((template) => template.id === id) || {
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

function inferWorkflowId(text) {
  const signals = readIntentSignals(text);

  if (signals.availabilityFollowup) return "reservation.verify_availability";
  if (signals.hasPhone && signals.callIntent) {
    return signals.appointmentIntent ? "phone.book_appointment" : "phone.general_call";
  }
  if (signals.appointmentIntent) return "phone.book_appointment";
  if (signals.billingIntent) return "billing.dispute_charge";
  if (signals.formIntent) return "browser.fill_form";
  if (signals.doordashIntent && (signals.cartPrepIntent || (signals.checkoutIntent && !signals.discoveryOnly))) {
    return "food.doordash_cart_build";
  }
  if (signals.uberEatsIntent && (signals.cartPrepIntent || (signals.checkoutIntent && !signals.discoveryOnly))) {
    return "food.ubereats_cart_build";
  }
  if (signals.shoppingIntent && (signals.cartPrepIntent || (signals.checkoutIntent && !signals.discoveryOnly))) {
    return "browser.purchase_until_checkout";
  }
  if (signals.foodOrderIntent) return "food.order_options";
  if (signals.reservationIntent) return "reservation.find_and_book";
  if (signals.shoppingIntent) {
    return "browser.product_options";
  }
  return "general.errand";
}

function doordashStoreHint(title) {
  const text = String(title || "").toLowerCase();
  const hints = [
    {
      match: /aria korean street food|aria korean/i,
      url: "https://www.doordash.com/en/store/aria-korean-street-food-san-francisco-161173/959830/"
    },
    {
      match: /halal city/i,
      url: "https://www.doordash.com/search/store/halal%20city/"
    },
    {
      match: /deli board/i,
      url: "https://www.doordash.com/search/store/deli%20board/"
    },
    {
      match: /gai chicken rice/i,
      url: "https://www.doordash.com/search/store/gai%20chicken%20rice/"
    }
  ];
  const hint = hints.find((item) => item.match.test(text));
  return hint
    ? `Exact DoorDash store URL to open first: ${hint.url}`
    : "No exact DoorDash store URL is known for this request.";
}

function doordashItemHint(title) {
  const text = String(title || "").toLowerCase();
  if (/aria korean street food|aria korean/i.test(text)) {
    return "Preferred item target for Aria Korean Street Food: Bulgogi Fries. If unavailable, choose Korean Fried Chicken or another visible popular entree.";
  }
  if (/halal city/i.test(text)) {
    return "Preferred item target for Halal City: Lamb over Rice or Chicken Gyro. If unavailable, choose another visible popular entree.";
  }
  if (/deli board/i.test(text)) {
    return "Preferred item target for Deli Board: a signature sandwich. If unavailable, choose another visible popular entree.";
  }
  return "No preferred item target is known. Choose one visible popular entree or normal meal item.";
}

function readIntentSignals(value) {
  const text = String(value || "").toLowerCase();
  const hasPhone = /(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/.test(text);
  const callIntent = /\b(call|phone|dial|ring|ask)\b/.test(text);
  const appointmentIntent = /\b(appointment|dentist|doctor|haircut|cleaning|schedule|book a time|book an appointment)\b/.test(text);
  const cuisineOrRestaurant = /\b(restaurant|dinner|chinese|italian|sushi|mexican|thai|indian|korean|pizza|mediterranean|latin|asian|rotisserie)\b/.test(text);
  const doordashIntent = /\bdoordash\b/.test(text);
  const uberEatsIntent = /\buber\s*eats\b|\bubereats\b/i.test(text);
  const reservationIntent = /\b(book|reserve|reservation|table|party of|for \d+ people|team dinner|opentable|resy)\b/.test(text) ||
    (cuisineOrRestaurant && /\b(tonight|tomorrow|around \d|at \d{1,2}(?::\d{2})?\s*(?:am|pm))\b/.test(text));
  const foodOrderIntent = /\b(doordash|order\s+(?:some\s+)?food|food order|food delivery|takeout|pickup|delivery|deliver|menu|meal|lunch|dinner order|check.*restaurant|restaurant.*order)\b/.test(text) ||
    (cuisineOrRestaurant && /\b(check|look up|find|food|eat|order|doordash|delivery|pickup|menu)\b/.test(text) && !reservationIntent);
  const shoppingIntent = /\b(order|buy|send|shop|purchase|get|cart|checkout|delivery|flowers?|gift|cake|doordash|target|food|meal|takeout|pickup)\b/.test(text);
  const discoveryOnly = /\b(best options?|options?|recommend|compare|look for|find|show me|research|don't checkout|do not checkout|no checkout|without checkout|before checkout|just give me)\b/.test(text);
  const cartPrepIntent = /\b(build|make|prepare|continue)\b.*\bcart\b|\badd\b.*\bcart\b/i.test(text);
  const checkoutIntent = /\b(proceed|continue)\b.*\bcheckout\b|\bcheckout\b|\bplace (?:the )?order\b|\bbuy it\b|\bpurchase it\b/i.test(text);
  const formIntent = /\b(fill|submit|complete)\b.*\b(form|application|portal|request)\b/.test(text);
  const billingIntent = /\b(dispute|refund|overcharge|charge|bill|billing|invoice)\b/.test(text);
  const availabilityFollowup = /\b(verify live availability|prepare booking|check availability|confirm reservation path)\b/.test(text);

  return {
    hasPhone,
    callIntent,
    appointmentIntent,
    doordashIntent,
    uberEatsIntent,
    foodOrderIntent,
    reservationIntent,
    shoppingIntent,
    discoveryOnly,
    cartPrepIntent,
    checkoutIntent,
    formIntent,
    billingIntent,
    availabilityFollowup
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
