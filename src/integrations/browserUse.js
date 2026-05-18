import { config } from "../lib/config.js";

export async function runBrowserTask({ task, metadata, maxCostUsd, outputSchema, model, sensitiveData, enableRecording, recordEvenWithSecrets }, options = {}) {
  if (!config.demo.allowBrowserUseLiveTask || !config.browserUse.apiKey) {
    return simulateBrowserTask({ task, metadata });
  }

  // Privacy guard: a session that uses sensitiveData fills real values into
  // form fields, and a video of the browser captures those values verbatim.
  // Recording undoes the secrecy of sensitiveData, so we refuse to record
  // unless the caller explicitly opts in with recordEvenWithSecrets.
  const hasSecrets = sensitiveData && Object.keys(sensitiveData).length > 0;
  const shouldRecord = Boolean(enableRecording) && (!hasSecrets || recordEvenWithSecrets === true);

  try {
    if (shouldUseBrowserProfile(metadata)) {
      await cleanupBrowserUseActiveSessions({ reason: "profile-task-preflight" }).catch(() => null);
    }

    let response = await createBrowserUseTask({ task, metadata, maxCostUsd, outputSchema, model, sensitiveData });

    if (!response.ok) {
      const errorText = await response.text();
      if (isBrowserUseConcurrencyLimit(response.status, errorText)) {
        const cleanup = await cleanupBrowserUseActiveSessions({ reason: "concurrency-limit" }).catch((error) => ({
          stopped: [],
          warning: error.message
        }));
        await wait(2000);
        response = await createBrowserUseTask({ task, metadata, maxCostUsd, outputSchema, model, sensitiveData });
        if (!response.ok) {
          const retryErrorText = await response.text();
          if (isBrowserUseConcurrencyLimit(response.status, retryErrorText)) {
            return browserUseConcurrencyResult(retryErrorText, cleanup);
          }
          return browserUseRejectedResult(response.status, retryErrorText);
        }
      } else {
        return browserUseRejectedResult(response.status, errorText);
      }
    }

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
    // Recording URLs are populated asynchronously after the session ends.
    // Per Browser Use docs: presigned, expire after 1 hour, may be empty
    // for tasks that never opened a browser. We wait briefly for the file
    // to be ready and then return whatever the session has.
    const recordingUrls = shouldRecord
      ? await waitForRecordingUrls(sessionId, finalData)
      : [];
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
      recordingUrls,
      recordingSkippedReason: enableRecording && !shouldRecord
        ? "Recording suppressed because sensitiveData was used. Set recordEvenWithSecrets=true on the workflow to override."
        : null,
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

function browserUseRejectedResult(status, errorText) {
  return {
    mode: "real",
    provider: "Browser Use",
    result: "Browser Use API rejected the task.",
    success: false,
    warning: `Browser Use API returned ${status}: ${errorText}`
  };
}

function browserUseConcurrencyResult(errorText, cleanup = {}) {
  const output = {
    status: "browser_use_capacity_limited",
    approval_required: true,
    auth_required: false,
    current_page_state: "Browser Use rejected the task because this account is at its active-session limit.",
    next_action: "Retry the task after the active Browser Use session finishes. GOFER already attempted active-session cleanup once.",
    blocker: parseBrowserUseErrorDetail(errorText) || "Too many concurrent active Browser Use sessions.",
    cleanup_stopped_sessions: cleanup.stopped?.length || 0,
    cleanup_warning: cleanup.warning || null
  };
  return {
    mode: "real",
    provider: "Browser Use",
    result: "Browser Use is at active-session capacity.",
    success: false,
    output: JSON.stringify(output),
    actionRequired: {
      type: "retry",
      message: output.next_action,
      blocker: output.blocker
    },
    warning: `Browser Use API returned 429: ${errorText}`,
    data: output
  };
}

function parseBrowserUseErrorDetail(errorText) {
  try {
    return JSON.parse(errorText)?.detail || null;
  } catch {
    return errorText || null;
  }
}

function isBrowserUseConcurrencyLimit(status, errorText) {
  return Number(status) === 429 || /too many concurrent active sessions|active-session limit|concurrent.*sessions/i.test(String(errorText || ""));
}

export async function testActualWebsite() {
  return runDoorDashCartDemo();
}

export async function runDoorDashDiscoveryDemo(options = {}) {
  const hasProfile = Boolean(config.browserUse.profileId);
  return runBrowserTask({
    task: [
      "You are GOFER's BrowserReconAgent running DoorDash discovery only.",
      hasProfile
        ? "A persistent Browser Use profile is configured. Use existing DoorDash session state only; do not start a new login or OAuth flow."
        : "No persistent profile is guaranteed. If DoorDash asks for login, OAuth, CAPTCHA, phone verification, or blocks browsing, stop and return auth_required=true.",
      "Do not add anything to cart. Do not open checkout. Do not enter payment. Do not place an order.",
      "Open https://www.doordash.com/ directly. Do not use Google, DuckDuckGo, Yelp, or broad web search.",
      "If DoorDash asks for a delivery address, use 680 Folsom St, San Francisco, CA.",
      "Use DoorDash visible search/results/category controls to find restaurants and likely food choices near that address.",
      "Prioritize restaurants that are likely open for delivery/pickup and have normal entree items. Prefer fast, reasonably priced options.",
      "Return 3 options with restaurant_name, food_choices, why_it_fits, estimated_price, and next_action.",
      "If DoorDash blocks direct discovery, do not fall back to web search; return the exact blocker and current page state.",
      "Set auth_required=true only if DoorDash requires login/OAuth/verification/CAPTCHA to continue.",
      "Return structured output with: status, auth_required, options, recommended_option, current_page_state, user_instruction, blocker."
    ].join(" "),
    maxCostUsd: 0.45,
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
      safety: "direct-doordash-discovery",
      useBrowserProfile: hasProfile,
      maxSteps: 18,
      maxRuntimeMs: 90000
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
      useBrowserProfile: true,
      maxSteps: 10,
      maxRuntimeMs: 90000
    }
  }, options);
}

export async function runPatientPortalDemo(options = {}) {
  const portalUrl = browserReachablePortalUrl();
  // Patient identifiers and insurance numbers go through Browser Use's
  // sensitiveData channel: the LLM only sees the *keys* (e.g. "member_id")
  // and inserts <secret>member_id</secret> placeholders into the form;
  // Browser Use fills the real value at the browser layer. Plaintext values
  // never appear in prompts, transcripts, or recordings.
  const sensitiveData = {
    member_id: "884720-DEMO",
    group_number: "YC-HACK-26"
  };
  return runBrowserTask({
    task: [
      `Open this exact URL: ${portalUrl}`,
      "Fill and submit the Dr. Carl Dental appointment request form.",
      "Patient name: Ajoson.",
      "Appointment type: Routine dental appointment.",
      "Preferred day: Wednesday.",
      "Preferred time: 3:00 PM.",
      "Insurance provider: Delta Dental PPO.",
      "Member ID: <secret>member_id</secret>.",
      "Notes: Please confirm any available appointment this week between 2 PM and 5 PM.",
      "Click the submit/request button once.",
      "Stop as soon as a confirmation/reference appears.",
      "Return JSON with status, confirmation_title, reference_number, fields_completed, and next_action. Do not echo the member ID or group number."
    ].join(" "),
    maxCostUsd: 0.35,
    model: "bu-mini",
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        confirmation_title: { type: "string" },
        reference_number: { type: "string" },
        fields_completed: {
          type: "array",
          items: { type: "string" }
        },
        next_action: { type: "string" }
      },
      required: ["status", "confirmation_title", "reference_number", "fields_completed"]
    },
    sensitiveData,
    metadata: {
      capability: "patient-portal-form",
      url: portalUrl,
      maxSteps: 10,
      maxRuntimeMs: 70000
    }
  }, options);
}

function browserReachablePortalUrl() {
  const base = config.appBaseUrl.replace(/\/$/, "");
  if (!/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(base)) {
    return `${base}/demo/patient-portal.html`;
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Dr Carl Dental Portal</title>
  <style>
    body{font-family:Arial,sans-serif;margin:32px;background:#f7f8fb;color:#17202a}
    main{max-width:640px;margin:auto;background:white;border:1px solid #d9dee5;border-radius:8px;padding:24px}
    label{display:block;margin:12px 0;font-weight:700}
    input,select,textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #c9d1dc;border-radius:6px;font:inherit}
    button{margin-top:12px;padding:12px 16px;border:0;border-radius:6px;background:#17202a;color:white;font-weight:800}
    #confirmation{display:none;margin-top:18px;padding:16px;border:1px solid #b8e5c2;background:#eefaf1;border-radius:8px}
  </style>
</head>
<body>
  <main>
    <h1>Dr Carl Dental Portal</h1>
    <p>Submit appointment requests for routine dental visits. Afternoon slots are prioritized this week.</p>
    <form id="appointment-form">
      <label>Patient name <input id="patient" name="patient" autocomplete="name" required></label>
      <label>Appointment type
        <select id="type" name="type" required>
          <option value="">Select one</option>
          <option>Routine dental appointment</option>
          <option>Cleaning</option>
          <option>Consultation</option>
        </select>
      </label>
      <label>Preferred day
        <select id="day" name="day" required>
          <option value="">Select one</option>
          <option>Monday</option><option>Tuesday</option><option>Wednesday</option><option>Thursday</option><option>Friday</option>
        </select>
      </label>
      <label>Preferred time
        <select id="time" name="time" required>
          <option value="">Select one</option>
          <option>2:00 PM</option><option>3:00 PM</option><option>4:00 PM</option><option>5:00 PM</option>
        </select>
      </label>
      <label>Insurance provider <input id="insurance" name="insurance" required></label>
      <label>Member ID <input id="member" name="member" required></label>
      <label>Notes for office <textarea id="notes" name="notes"></textarea></label>
      <button id="submit-request" type="submit">Submit appointment request</button>
    </form>
    <section id="confirmation" aria-live="polite">
      <h2>Appointment request received</h2>
      <p>Reference: <strong>CARL-DEMO-2048</strong></p>
      <p>The office will confirm the selected 2 PM to 5 PM appointment window by phone.</p>
    </section>
  </main>
  <script>
    document.getElementById('appointment-form').addEventListener('submit', function (event) {
      event.preventDefault();
      document.getElementById('confirmation').style.display = 'block';
      document.getElementById('confirmation').scrollIntoView();
    });
  </script>
</body>
</html>`;

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

async function createBrowserUseTask({ task, metadata, maxCostUsd = 0.75, outputSchema, model = "claude-sonnet-4.6", sensitiveData, enableRecording = false }) {
  const v3BaseUrl = browserUseApiOrigin();
  const body = {
    task,
    model,
    keepAlive: false,
    maxCostUsd,
    proxyCountryCode: "us",
    enableRecording: Boolean(enableRecording),
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
  if (config.browserUse.profileId && shouldUseBrowserProfile(metadata)) {
    body.profileId = config.browserUse.profileId;
  }
  if (sensitiveData && Object.keys(sensitiveData).length > 0) {
    body.sensitiveData = sensitiveData;
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

function shouldUseBrowserProfile(metadata = {}) {
  if (metadata.useBrowserProfile === true || metadata.profileApproved === true) return true;
  if (!config.browserUse.profileId) return false;
  const foodCapabilities = ["food-order-discovery", "doordash-cart-build", "doordash-discovery", "doordash-cart-demo"];
  return foodCapabilities.includes(metadata.capability || "");
}

export async function cleanupBrowserUseActiveSessions({ reason = "cleanup" } = {}) {
  if (!config.browserUse.apiKey) return { stopped: [], reason };
  const origin = browserUseApiOrigin();
  const response = await fetch(`${origin}/api/v3/sessions`, {
    headers: {
      "X-Browser-Use-API-Key": config.browserUse.apiKey
    }
  });
  if (!response.ok) {
    throw new Error(`Browser Use session list failed with ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json();
  const sessions = normalizeBrowserUseSessionList(payload);
  const active = sessions.filter(isBrowserUseActiveSession);
  const stopped = [];
  for (const session of active) {
    const sessionId = session.id || session.sessionId;
    if (!sessionId) continue;
    const result = await stopBrowserUseSession(sessionId).catch((error) => ({ error: error.message }));
    stopped.push({
      sessionId,
      status: session.status || session.sessionStatus || "unknown",
      title: session.title || session.task || session.taskTitle || null,
      result
    });
  }
  return { stopped, reason };
}

function normalizeBrowserUseSessionList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.sessions)) return payload.sessions;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function isBrowserUseActiveSession(session) {
  const status = String(session?.status || session?.sessionStatus || "").toLowerCase();
  if (!status) return false;
  return ["running", "active", "created", "queued", "starting", "pending", "in_progress"].includes(status);
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
  const lastStepSummary = session?.lastStepSummary || null;
  const screenshotUrl = session?.screenshotUrl || null;
  if (isAnonymousDoorDash) {
    return JSON.stringify({
      status: "action_required",
      auth_required: true,
      current_page_state: `GOFER stopped the anonymous DoorDash run after ${steps} steps at $${cost}.`,
      last_step: lastStepSummary,
      screenshot_url: screenshotUrl,
      user_instruction: "Sign in to DoorDash through a Browser Use persistent profile, then rerun the cart step.",
      blocker: "DoorDash anonymous browsing is consuming Browser Use steps/cost without reaching a safe cart state. A persistent authenticated profile is required for checkout-level automation."
    });
  }
  if (maxSteps && Number(steps) >= maxSteps) {
    return JSON.stringify({
      status: "stopped_by_gofer",
      approval_required: true,
      auth_required: false,
      current_page_state: `GOFER stopped Browser Use after ${steps} steps at $${cost}.`,
      last_step: lastStepSummary,
      screenshot_url: screenshotUrl,
      next_action: "Retry with a narrower browser task, approve a fallback tool such as phone/email, or provide authentication/profile state if the site is blocked.",
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

// Recording URLs are populated asynchronously after a session ends. Per the
// Browser Use docs, the SDK helper waits up to ~15s; we replicate that with
// short polls. Returns [] when no recording is available (e.g. tasks that
// never opened a browser) instead of throwing.
async function waitForRecordingUrls(sessionId, finalData) {
  const initial = extractRecordingUrls(finalData);
  if (initial.length > 0) return initial;
  if (!sessionId) return [];

  const origin = browserUseApiOrigin();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await wait(1000);
    try {
      const response = await fetch(`${origin}/api/v3/sessions/${sessionId}`, {
        headers: { "X-Browser-Use-API-Key": config.browserUse.apiKey }
      });
      if (!response.ok) continue;
      const session = await response.json();
      const urls = extractRecordingUrls(session);
      if (urls.length > 0) return urls;
    } catch {
      // Network blip; let the loop try again until the deadline.
    }
  }
  return [];
}

function extractRecordingUrls(session) {
  if (!session) return [];
  const candidates = session.recordingUrls || session.recording_urls || [];
  if (!Array.isArray(candidates)) return [];
  return candidates.filter((url) => typeof url === "string" && url.length > 0);
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
  if (parsed?.status === "browser_use_capacity_limited") {
    return {
      type: "retry",
      message: parsed.next_action || "Retry after Browser Use active-session capacity is available.",
      blocker: parsed.blocker || "Browser Use active-session limit reached."
    };
  }
  if (parsed?.auth_required === true) {
    return {
      type: "auth",
      message: parsed.user_instruction || "Please sign in in the live Browser Use session, then rerun the cart step.",
      blocker: parsed.blocker || "DoorDash requires authentication."
    };
  }
  if (parsed?.auth_required === false) {
    return null;
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

  if (capability === "product-discovery") {
    return {
      mode: "simulated",
      provider: "Browser Use",
      result: "Product options found. User choice required before cart or checkout.",
      output: JSON.stringify({
        status: "Found product options.",
        approval_required: true,
        merchant: inferMerchantFromTask(task) || "Suggested merchant",
        recommended_option: "Mom-friendly bouquet option",
        options: [
          {
            name: "Seasonal bouquet",
            price: "$25-$40",
            why_it_fits: "Classic gift option with a warmer, celebratory feel.",
            url_or_path: "Search result or merchant product page",
            availability: "availability_not_verified"
          },
          {
            name: "Potted orchid",
            price: "$30-$50",
            why_it_fits: "Lasts longer than cut flowers and feels more premium for Mom.",
            url_or_path: "Search result or merchant product page",
            availability: "availability_not_verified"
          },
          {
            name: "Rose and lily arrangement",
            price: "$35-$60",
            why_it_fits: "Giftable arrangement with strong visual impact.",
            url_or_path: "Search result or merchant product page",
            availability: "availability_not_verified"
          }
        ],
        next_action: "Choose an option before GOFER builds a cart. GOFER will still stop before checkout and payment.",
        blockers: []
      })
    };
  }

  if (capability === "food-order-discovery") {
    return {
      mode: "simulated",
      provider: "Browser Use",
      result: "Food ordering options found. User choice required before cart or checkout.",
      output: JSON.stringify({
        status: "Found food order options.",
        approval_required: true,
        merchant: inferMerchantFromTask(task) || "Restaurant delivery",
        recommended_option: "Recommended entree option",
        options: [
          {
            name: "Restaurant signature entree",
            price: "$15-$25",
            why_it_fits: "Good default meal option for delivery or pickup.",
            url_or_path: "Public menu or delivery listing",
            availability: "availability_not_verified"
          },
          {
            name: "Shareable side or appetizer",
            price: "$8-$15",
            why_it_fits: "Useful add-on if ordering for more than one person.",
            url_or_path: "Public menu or delivery listing",
            availability: "availability_not_verified"
          },
          {
            name: "Popular bowl or plate",
            price: "$14-$22",
            why_it_fits: "Likely delivery-friendly and easy to customize.",
            url_or_path: "Public menu or delivery listing",
            availability: "availability_not_verified"
          }
        ],
        next_action: "Choose a food option before GOFER builds a cart. GOFER will still stop before checkout and payment.",
        blockers: []
      })
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

  if (capability === "injected-workflow") {
    return {
      mode: "simulated",
      provider: "Browser Use",
      result: "Injected workflow completed reversible preparation.",
      output: JSON.stringify({
        status: "Prepared injected workflow result.",
        approval_required: true,
        completed_steps: [
          "Interpreted the foreign request.",
          "Selected the safest available sponsor tools.",
          "Prepared reversible next steps only."
        ],
        findings: [
          {
            title: "Workflow ready",
            detail: "GOFER can continue with browser research, phone, email, or payment tooling depending on user approval.",
            source_or_path: "WorkflowInjectorAgent"
          }
        ],
        recommended_next_step: "Ask the user to approve the proposed next action or clarify missing details.",
        next_action: "Approve the proposed next action or provide missing details. GOFER will not take irreversible action without confirmation.",
        blockers: []
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

function inferMerchantFromTask(task) {
  const text = String(task || "");
  const match = text.match(/\b(target|doordash|amazon|walmart|costco|instacart|whole foods|trader joe'?s|cantoo|urbanstems|bouqs|farmgirl)\b/i);
  return match ? match[0] : null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
