import { config } from "../lib/config.js";

export async function runBrowserTask({ task, metadata, maxCostUsd, outputSchema, model }, options = {}) {
  if (!config.demo.allowBrowserUseLiveTask || !config.browserUse.apiKey) {
    return simulateBrowserTask({ task, metadata });
  }

  try {
    const response = await createBrowserUseTask({ task, metadata, maxCostUsd, outputSchema, model });

    if (!response.ok) {
      return {
        mode: "real",
        provider: "Browser Use",
        result: "Browser Use API rejected the task.",
        success: false,
        warning: `Browser Use API returned ${response.status}: ${await response.text()}`
      };
    }

    const data = await response.json();
    const sessionId = data.sessionId || data.id;
    const liveUrl = data.liveUrl || data.live_url || null;
    options.onSessionStart?.({
      sessionId,
      taskId: data.id,
      liveUrl,
      data
    });
    const completed = await pollBrowserUseSession(sessionId, { maxCostUsd, metadata }).catch((error) => ({
      ...data,
      status: "error",
      isTaskSuccessful: false,
      output: `Polling failed: ${error.message}`
    }));
    const finalData = completed || data;
    const success = normalizeSuccess(finalData);
    return {
      mode: "real",
      provider: "Browser Use",
      result: success === false ? "Browser Use task failed." : "Browser Use task completed.",
      sessionId: finalData.sessionId || finalData.id || data.sessionId || data.id,
      taskId: data.id,
      liveUrl: finalData.liveUrl || finalData.live_url || data.liveUrl || data.live_url || null,
      output: normalizeOutput(finalData),
      actionRequired: detectActionRequired(finalData),
      success,
      data: finalData
    };
  } catch (error) {
    return {
      mode: "real",
      provider: "Browser Use",
      result: "Browser Use task crashed before completion.",
      success: false,
      warning: error.message
    };
  }
}

export async function testActualWebsite() {
  return runDoorDashCartDemo();
}

export async function runDoorDashDiscoveryDemo(options = {}) {
  return runBrowserTask({
    task: [
      "You are GOFER's BrowserReconAgent running DoorDash public discovery only.",
      "Do not sign in. Do not add anything to cart. Do not open checkout. Do not enter payment.",
      "Use web search or public DoorDash pages to find restaurants and likely food choices near 680 Folsom St, San Francisco, CA.",
      "Prioritize restaurants that are likely open for delivery/pickup and have normal entree items.",
      "Return 3 options with restaurant_name, food_choices, why_it_fits, estimated_price, and next_action.",
      "If DoorDash blocks access or asks for login, do not fail. Return the best public options found and set auth_required=false because cart-building is the later authenticated step.",
      "Return structured output with: status, auth_required, options, recommended_option, current_page_state, user_instruction, blocker."
    ].join(" "),
    maxCostUsd: 0.25,
    model: "bu-mini",
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        auth_required: { type: "boolean" },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              restaurant_name: { type: "string" },
              food_choices: {
                type: "array",
                items: { type: "string" }
              },
              why_it_fits: { type: "string" },
              estimated_price: { type: "string" },
              next_action: { type: "string" }
            }
          }
        },
        recommended_option: { type: "string" },
        current_page_state: { type: "string" },
        user_instruction: { type: "string" },
        blocker: { type: "string" }
      },
      required: ["status", "auth_required", "options", "current_page_state"]
    },
    metadata: {
      capability: "doordash-discovery",
      safety: "public-discovery-before-auth",
      maxSteps: 8,
      maxRuntimeMs: 70000
    }
  }, options);
}

export async function runDoorDashCartDemo(options = {}) {
  const hasProfile = Boolean(config.browserUse.profileId);
  if (!hasProfile) {
    return browserUseProfileRequiredResult();
  }

  return runBrowserTask({
    task: [
      "You are GOFER's BrowserReconAgent running a non-destructive DoorDash cart demo.",
      "A persistent authenticated Browser Use profile is configured. Use that existing DoorDash login state. Do not perform OAuth/login unless the existing session has expired.",
      "Goal: find food first, add one item to cart if possible, then stop at cart/checkout review before payment or order submission.",
      "Do not enter payment. Do not place an order. Do not create a new account.",
      "Do not perform broad web searches, do not inspect full HTML, and do not dump the DOM. Use visible page controls only.",
      "Open https://www.doordash.com/ and keep the run short.",
      "If DoorDash asks for a location, use 680 Folsom St, San Francisco, CA.",
      "If a sign-in, OAuth, phone verification, or CAPTCHA screen appears, stop immediately with auth_required=true; do not loop through login.",
      "Find a restaurant and food menu option using visible cards/search only.",
      "Choose one normal food item, preferably a pizza, burger, sandwich, bowl, taco, or similar entree.",
      "If customization is required, choose the first reasonable default options.",
      "Add exactly one item to the cart.",
      "Only after the cart or checkout review requires authentication, treat login as a handoff point.",
      "If DoorDash requires OAuth, email sign-in, phone verification, account creation, CAPTCHA, or identity verification, do not attempt to bypass it and do not loop. Stop immediately and return auth_required=true with the current live URL and a short user instruction: 'Please sign in to DoorDash in the live browser, then rerun the cart step.'",
      "If you reach a cart or checkout review page where the selected item is visible, stop immediately before payment/order submission.",
      "Return structured output with: status, auth_required, restaurant_name, selected_item, subtotal, current_page_state, user_instruction, blocker."
    ].join(" "),
    maxCostUsd: 0.65,
    model: "gemini-3-flash",
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        auth_required: { type: "boolean" },
        restaurant_name: { type: "string" },
        selected_item: { type: "string" },
        subtotal: { type: "string" },
        current_page_state: { type: "string" },
        user_instruction: { type: "string" },
        blocker: { type: "string" }
      },
      required: ["status", "auth_required", "current_page_state"]
    },
    metadata: {
      capability: "doordash-cart-demo",
      url: "https://www.doordash.com/",
      safety: "stop-before-checkout",
      requiresProfileForReliability: true,
      hasProfile,
      maxSteps: 10,
      maxRuntimeMs: 90000
    }
  }, options);
}

export async function runPatientPortalDemo(options = {}) {
  const portalUrl = browserReachablePortalUrl();
  return runBrowserTask({
    task: [
      `Open ${portalUrl}.`,
      "Fill the patient appointment portal for Ajoson.",
      "Appointment type: Routine dental appointment.",
      "Preferred day: Wednesday.",
      "Preferred time: 3:00 PM.",
      "Insurance provider: Delta Dental PPO.",
      "Member ID: 884720-DEMO.",
      "Notes: Please confirm any available appointment this week between 2 PM and 5 PM.",
      "Submit the appointment request.",
      "Return the confirmation title and reference number."
    ].join(" "),
    maxCostUsd: 0.5,
    metadata: { capability: "patient-portal-form", url: portalUrl }
  }, options);
}

function browserReachablePortalUrl() {
  const base = config.appBaseUrl.replace(/\/$/, "");
  if (!/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(base)) {
    return `${base}/demo/patient-portal.html`;
  }

  const html = `<!doctype html><html><head><title>Dr Carl Dental Portal</title></head><body><h1>Dr Carl Dental Portal</h1><form><label>Patient <input name="patient"></label><br><label>Type <input name="type"></label><br><label>Day <input name="day"></label><br><label>Time <input name="time"></label><br><label>Insurance <input name="insurance"></label><br><label>Member ID <input name="member"></label><br><label>Notes <textarea name="notes"></textarea></label><br><button type="button">Save request</button></form><p id="reference">Reference after save: CARL-DEMO-2048</p></body></html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function pollBrowserUseSession(sessionId, options = {}) {
  if (!sessionId) return null;
  const origin = browserUseApiOrigin();
  const deadline = Date.now() + Number(options.metadata?.maxRuntimeMs || 120000);
  let last = null;
  const maxCostUsd = Number(options.maxCostUsd || 0);
  const isAnonymousDoorDash = options.metadata?.capability === "doordash-cart-demo" && !config.browserUse.profileId;
  const maxSteps = Number(options.metadata?.maxSteps || 0);

  while (Date.now() < deadline) {
    await wait(1500);
    const response = await fetch(`${origin}/api/v3/sessions/${sessionId}`, {
      headers: {
        "X-Browser-Use-API-Key": config.browserUse.apiKey
      }
    });
    if (!response.ok) continue;
    last = await response.json();
    if (isBrowserUseTerminal(last)) {
      return last;
    }
    if (shouldStopBrowserUseSession(last, { maxCostUsd, isAnonymousDoorDash, maxSteps })) {
      const stopped = await stopBrowserUseSession(sessionId).catch(() => null);
      return {
        ...(stopped || last),
        isTaskSuccessful: false,
        output: buildLocalStopOutput(stopped || last, { maxCostUsd, isAnonymousDoorDash, maxSteps })
      };
    }
  }

  if (!last) return null;
  const stopped = await stopBrowserUseSession(sessionId).catch(() => null);
  if (stopped) {
    return {
      ...stopped,
      isTaskSuccessful: false,
      output: normalizeOutput(stopped) || `Stopped Browser Use session ${sessionId} after local runtime limit. Last status before stop: ${last.status || "unknown"}.`
    };
  }
  return {
    ...last,
    isTaskSuccessful: false,
    output: normalizeOutput(last) || `Timed out waiting for Browser Use session ${sessionId}. Last status: ${last.status || "unknown"}.`
  };
}

async function createBrowserUseTask({ task, metadata, maxCostUsd = 0.75, outputSchema, model = "claude-sonnet-4.6" }) {
  const v3BaseUrl = browserUseApiOrigin();
  const body = {
    task,
    model,
    keepAlive: false,
    maxCostUsd,
    proxyCountryCode: "us",
    enableRecording: false,
    agentmail: false,
    skills: false,
    metadata
  };
  if (config.browserUse.workspaceId) {
    body.workspaceId = config.browserUse.workspaceId;
    body.cacheScript = true;
  }
  if (outputSchema) {
    body.outputSchema = outputSchema;
  }
  if (config.browserUse.profileId) {
    body.profileId = config.browserUse.profileId;
  }

  const response = await fetch(`${v3BaseUrl}/api/v3/sessions`, {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": config.browserUse.apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return response;
}

function shouldStopBrowserUseSession(session, { maxCostUsd, isAnonymousDoorDash, maxSteps }) {
  const totalCost = Number(session?.totalCostUsd || 0);
  if (maxCostUsd && totalCost >= maxCostUsd) return true;
  if (isAnonymousDoorDash && Number(session?.stepCount || 0) >= 4) return true;
  if (maxSteps && Number(session?.stepCount || 0) >= maxSteps) return true;
  return false;
}

function buildLocalStopOutput(session, { maxCostUsd, isAnonymousDoorDash, maxSteps }) {
  const status = session?.status || "unknown";
  const cost = session?.totalCostUsd || "unknown";
  const steps = session?.stepCount ?? "unknown";
  if (isAnonymousDoorDash) {
    return JSON.stringify({
      status: "action_required",
      auth_required: true,
      current_page_state: `GOFER stopped the anonymous DoorDash run after ${steps} steps at $${cost}.`,
      user_instruction: "Sign in to DoorDash through a Browser Use persistent profile, then rerun the cart step.",
      blocker: "DoorDash anonymous browsing is consuming Browser Use steps/cost without reaching a safe cart state. A persistent authenticated profile is required for checkout-level automation."
    });
  }
  if (maxSteps && Number(steps) >= maxSteps) {
    return JSON.stringify({
      status: "stopped_by_gofer",
      auth_required: false,
      current_page_state: `GOFER stopped Browser Use after ${steps} steps at $${cost}.`,
      blocker: "The Browser Use task exceeded GOFER's step budget before producing the required workflow result."
    });
  }
  return `GOFER stopped Browser Use session locally at $${cost}${maxCostUsd ? ` / $${maxCostUsd}` : ""}. Last status: ${status}.`;
}

function browserUseProfileRequiredResult() {
  const output = {
    status: "action_required",
    auth_required: true,
    current_page_state: "No Browser Use profile is configured for DoorDash, so GOFER did not launch a slow anonymous session.",
    user_instruction: "Sync or create a Browser Use profile where DoorDash is already signed in, then set BROWSER_USE_PROFILE_ID and restart GOFER.",
    blocker: "DoorDash uses login/OAuth/verification and Cloudflare mitigation. Persistent Browser Use profile state is required for fast checkout-level automation."
  };
  return {
    mode: "blocked",
    provider: "Browser Use",
    result: "DoorDash requires an authenticated Browser Use profile.",
    success: false,
    output: JSON.stringify(output),
    actionRequired: {
      type: "auth",
      message: output.user_instruction,
      blocker: output.blocker
    },
    data: output
  };
}

async function stopBrowserUseSession(sessionId) {
  const origin = browserUseApiOrigin();
  const response = await fetch(`${origin}/api/v3/sessions/${sessionId}/stop`, {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": config.browserUse.apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ strategy: "session" })
  });
  if (!response.ok) return null;
  return response.json();
}

function isBrowserUseTerminal(session) {
  if (!session) return false;
  if (session.isTaskSuccessful !== null && session.isTaskSuccessful !== undefined) return true;
  const status = session.status || session.sessionStatus;
  if (["stopped", "timed_out", "error", "failed"].includes(status)) return true;
  if (status === "idle" && session.output) return true;
  return false;
}

function normalizeSuccess(session) {
  if (session?.isTaskSuccessful !== null && session?.isTaskSuccessful !== undefined) {
    return session.isTaskSuccessful;
  }
  const status = session?.status || session?.sessionStatus;
  if (["timed_out", "error", "failed"].includes(status)) return false;
  if (typeof session?.output === "string" && session.output.includes("BLOCKED_BY_AUTH_MODAL")) return false;
  if (detectActionRequired(session)) return false;
  return null;
}

function normalizeOutput(session) {
  const output = session?.output;
  if (output === null || output === undefined) return null;
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function detectActionRequired(session) {
  const output = session?.output;
  const parsed = parseOutput(output);
  const text = typeof output === "string" ? output : JSON.stringify(output || {});
  if (parsed?.auth_required === true) {
    return {
      type: "auth",
      message: parsed.user_instruction || "Please sign in in the live Browser Use session, then rerun the cart step.",
      blocker: parsed.blocker || "DoorDash requires authentication."
    };
  }
  if (/BLOCKED_BY_AUTH_MODAL|auth_required["']?\s*:\s*true|auth required|sign in|login|oauth|verification|captcha/i.test(text)) {
    return {
      type: "auth",
      message: "Please complete the required authentication in the live browser, then rerun the step.",
      blocker: "The target website requires authentication before the next step."
    };
  }
  return null;
}

function parseOutput(output) {
  if (!output) return null;
  if (typeof output === "object") return output;
  const text = String(output).trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const candidates = [
    text,
    unfenced,
    unfenced.slice(unfenced.indexOf("{"), unfenced.lastIndexOf("}") + 1)
  ].filter((candidate) => candidate && candidate.includes("{"));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next possible JSON shape.
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function browserUseApiOrigin() {
  const parsed = new URL(config.browserUse.baseUrl);
  return `${parsed.protocol}//${parsed.host}`;
}

export async function readNotionTasks(seedTasks) {
  if (!config.browserUse.apiKey) {
    await wait(600);
    return {
      mode: "simulated",
      provider: "Browser Use",
      tasks: seedTasks,
      narrative: "Read Notion task database and extracted actionable errands."
    };
  }

  return runBrowserTask({
    task: "Open the user's Notion workspace, find actionable todo items for GOFER, and return titles, notes, and due dates as JSON.",
    metadata: { capability: "notion-intake" }
  });
}

export async function writeNotionResult({ title, result }) {
  if (!config.browserUse.apiKey) {
    await wait(350);
    return {
      mode: "simulated",
      provider: "Browser Use",
      result: `Checked off "${title}" in Notion with note: ${result}`
    };
  }

  return runBrowserTask({
    task: `In Notion, mark the task "${title}" complete and add this result note: ${result}`,
    metadata: { capability: "notion-writeback" }
  });
}

async function simulateBrowserTask({ task, metadata }) {
  await wait(900);
  const capability = metadata?.capability || "browser";

  if (capability === "billing-dispute") {
    return {
      mode: "simulated",
      provider: "Browser Use",
      result: "PG&E dispute draft prepared for the $47 duplicated charge. Submission requires approval.",
      output: JSON.stringify({
        status: "Dispute draft prepared.",
        approval_required: true,
        portal_or_company: "PG&E",
        disputed_amount: "$47",
        evidence_found: ["Billing period April 2026 appears duplicated."],
        draft_dispute: "I am disputing a duplicated $47 charge for the April 2026 billing period.",
        next_action: "Approve final dispute submission in the portal.",
        blockers: []
      }),
      screenshot: "/mock-confirmation/pge-dispute.png",
      steps: [
        "Opened authenticated PG&E portal",
        "Navigated Billing > View Charges",
        "Selected duplicated $47 charge",
        "Drafted dispute form",
        "Stopped before final submission"
      ]
    };
  }

  if (capability === "purchase" || capability === "purchase-until-checkout") {
    return {
      mode: "simulated",
      provider: "Browser Use",
      result: "Peony order cart prepared for Mom with delivery on June 4. Payment and order submission require approval.",
      output: JSON.stringify({
        status: "Cart prepared.",
        approval_required: true,
        merchant: "Demo florist",
        selected_items: ["Peony arrangement", "June 4 delivery"],
        subtotal: "$55",
        checkout_state: "stopped_before_payment",
        next_action: "Approve payment and final order submission.",
        blockers: []
      }),
      amount: 55,
      steps: [
        "Opened florist checkout",
        "Selected peony arrangement",
        "Entered delivery details",
        "Stopped before payment and order submission"
      ]
    };
  }

  if (capability === "doordash-discovery") {
    return {
      mode: "simulated",
      provider: "Browser Use",
      result: "DoorDash public discovery completed. Cart building requires profile approval.",
      output: JSON.stringify({
        status: "Found public food options near 680 Folsom St.",
        auth_required: false,
        recommended_option: "Dumpling Time - pork soup dumplings or shrimp toast",
        options: [
          {
            restaurant_name: "Dumpling Time",
            food_choices: ["Pork soup dumplings", "Shrimp toast", "Garlic noodles"],
            why_it_fits: "Close to SoMa/Mission Bay and good for a quick team meal.",
            estimated_price: "$$",
            next_action: "Approve profile use to add one selected item to cart."
          },
          {
            restaurant_name: "RT Rotisserie",
            food_choices: ["Chicken bowl", "Rotisserie chicken sandwich"],
            why_it_fits: "Reliable delivery-friendly entree options.",
            estimated_price: "$$",
            next_action: "Approve profile use to add one selected item to cart."
          },
          {
            restaurant_name: "The Bird",
            food_choices: ["Fried chicken sandwich", "Loaded fries"],
            why_it_fits: "Fast casual option near downtown with straightforward cart items.",
            estimated_price: "$",
            next_action: "Approve profile use to add one selected item to cart."
          }
        ],
        current_page_state: "Public discovery only; no login or cart action attempted.",
        user_instruction: "Pick an option, then approve profile use to build the cart.",
        blocker: ""
      })
    };
  }

  return {
    mode: "simulated",
    provider: "Browser Use",
    result: "Browser task completed.",
    task
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
