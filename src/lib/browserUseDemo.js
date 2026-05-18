import { dispatchAgentJob } from "../agents/manager.js";
import { addArtifact, addChatMessage, createRun, emit, updateRun, updateTask } from "./store.js";

let activeBrowserUseDemo = null;

export function isBrowserUseDemoRunning() {
  return Boolean(activeBrowserUseDemo);
}

export async function startBrowserUseDemo(kind = "doordash") {
  if (activeBrowserUseDemo) {
    throw new Error("Browser Use demo is already running. Wait for the current BrowserReconAgent job to finish before starting another session.");
  }

  activeBrowserUseDemo = runBrowserUseDemo(kind);
  try {
    return await activeBrowserUseDemo;
  } finally {
    activeBrowserUseDemo = null;
  }
}

async function runBrowserUseDemo(kind = "doordash") {
  const isPortal = kind === "portal";
  const task = {
    id: `browser-test-${Date.now()}`,
    sourceId: "browser-test",
    title: isPortal ? "Browser Use: fill Dr. Carl patient portal" : "Browser Use: find DoorDash options",
    source: "GOFER",
    type: "browser_test",
    label: isPortal ? "Patient portal automation" : "Food discovery before cart",
    status: "running",
    stage: "Starting Browser Use Cloud session",
    tools: ["browserUse"],
    fallbackTools: [],
    parallelizable: false,
    constraints: {},
    artifacts: [],
    result: null,
    error: null
  };

  const run = createRun([task]);
  try {
    let liveArtifactAdded = false;
    const result = await dispatchAgentJob("browser-recon", isPortal ? "patient-portal" : "doordash-discovery", {}, {
      onProgress: (progress) => {
        if (progress.phase !== "browser-session-started" || !progress.liveUrl || liveArtifactAdded) return;
        liveArtifactAdded = true;
        addArtifact(run.id, task.id, {
          kind: "browser",
          title: isPortal ? "Browser Use live patient portal" : "Browser Use live DoorDash discovery",
          detail: `Session ${progress.sessionId} is running. Watch this live; final status will appear below when Browser Use finishes.`,
          liveUrl: progress.liveUrl
        });
        updateTask(run.id, task.id, {
          stage: "Browser Use Cloud session running"
        });
        emit("browseruse.test", {
          mode: "real",
          sessionId: progress.sessionId,
          taskId: progress.taskId,
          liveUrl: progress.liveUrl,
          warning: null
        });
      }
    });
    addArtifact(run.id, task.id, {
      kind: "browser",
      title: isPortal ? "Browser Use patient portal session" : "DoorDash options found",
      detail: result.mode === "blocked"
        ? "GOFER did not start Browser Use because this workflow needs a persistent authenticated profile first."
        : result.mode === "real"
        ? `Session ${result.sessionId} ${result.success === false ? "failed" : "completed"} ${isPortal ? "against the Dr. Carl patient portal" : "for DoorDash discovery"}.`
        : "Browser Use fell back to local simulation.",
      liveUrl: result.liveUrl,
      output: result.output || result.data?.output || null,
      actionRequired: result.actionRequired || null,
      warning: result.warning || null
    });
    if (!isPortal && result.success !== false) {
      const parsed = parseBrowserOutput(result.output || result.data?.output);
      const optionNames = (parsed?.options || [])
        .map((option) => option?.restaurant_name || option?.name)
        .filter(Boolean);
      const recommendation = parsed?.recommended_option || optionNames[0] || "the best option";
      addArtifact(run.id, task.id, {
        kind: "approval",
        title: "Cart build approval required",
        detail: "Choose a food option in chat and approve Browser Use profile access to build the DoorDash cart. GOFER will stop before payment or order submission.",
        approvalGates: ["profile_access", "payment", "order_submission"]
      });
      addChatMessage(
        "assistant",
        [
          parsed?.status || "I found DoorDash food options.",
          `Recommended: ${recommendation}.`,
          optionNames.length ? `Options: ${optionNames.join(", ")}.` : "",
          "Reply with a restaurant name to choose it. Cart building needs your approved Browser Use profile, and I will stop before payment or order submission."
        ].filter(Boolean).join(" "),
        {
          runId: run.id,
          taskId: task.id,
          action: "doordash_options_ready",
          recommendation,
          options: optionNames
        }
      );
    }
    const retryableDiscovery = result.success === false && !isPortal && isRetryablePublicDiscoveryStop(result);
    const pendingHandoff = result.success === false && !isPortal && !retryableDiscovery && isRecoverableBrowserHandoff(result);
    if (retryableDiscovery) {
      addArtifact(run.id, task.id, {
        kind: "approval",
        title: "DoorDash public search needs retry",
        detail: "Browser Use cancelled the public search before returning options. Retry will use search snippets only and will not sign in, add to cart, checkout, or pay.",
        approvalGates: ["profile_access", "payment", "order_submission"],
        output: result.output || null
      });
      addChatMessage(
        "assistant",
        "Browser Use cancelled the DoorDash public search before returning options. Reply `retry` to run the search-snippet-only discovery again. I will not sign in, add to cart, checkout, or pay.",
        {
          runId: run.id,
          taskId: task.id,
          action: "doordash_discovery_retry_requested"
        }
      );
    }
    if (pendingHandoff) {
      addArtifact(run.id, task.id, {
        kind: "approval",
        title: "Browser profile/setup required",
        detail: result.actionRequired?.message || parseBrowserOutput(result.output)?.user_instruction || "Browser Use needs user setup before GOFER can continue.",
        approvalGates: ["profile_access", "payment", "order_submission"],
        output: result.output || null
      });
      addChatMessage(
        "assistant",
        "Browser Use needs a profile/login handoff before cart-level automation. Complete the setup, then reply `approve profile`. I will still stop before payment or order submission.",
        {
          runId: run.id,
          taskId: task.id,
          action: "browser_profile_handoff_requested"
        }
      );
    }
    const waitingForChoice = !isPortal && result.success !== false;
    updateTask(run.id, task.id, {
      status: pendingHandoff || retryableDiscovery || waitingForChoice ? "pending" : result.success === false ? "failed" : "completed",
      stage: pendingHandoff
        ? "Waiting for browser profile approval"
        : retryableDiscovery
          ? "Waiting for DoorDash discovery retry"
          : waitingForChoice
            ? "Waiting for food option selection"
          : result.success === false ? "Blocked or failed" : "Completed",
      error: pendingHandoff || retryableDiscovery || waitingForChoice ? null : result.success === false ? result.output || result.warning || "Browser Use did not complete the workflow." : null,
      result: pendingHandoff
        ? "Browser profile/login handoff required before GOFER can continue."
        : retryableDiscovery
          ? "DoorDash public discovery needs a search-only retry."
        : waitingForChoice
          ? "DoorDash options are ready. Choose one in chat, then approve profile use to build the cart."
        : result.success === false
          ? result.mode === "blocked"
            ? "Browser Use profile setup required before this workflow can run quickly."
            : "Browser Use did not complete the requested workflow. See the final artifact for the exact blocker."
          : result.mode === "real"
          ? isPortal
            ? "Real Browser Use session completed the patient portal workflow."
            : "DoorDash options are ready. Choose one in chat, then approve profile use to build the cart."
          : "Browser Use test completed in fallback mode."
    });
    updateRun(run.id, {
      status: pendingHandoff || retryableDiscovery || waitingForChoice ? "waiting_for_approval" : result.success === false ? "completed_with_errors" : "completed",
      completedAt: new Date().toISOString(),
      summary: pendingHandoff
        ? "Browser Use is waiting for profile/login approval."
        : retryableDiscovery
          ? "DoorDash public discovery is waiting for retry approval."
        : waitingForChoice
          ? "DoorDash discovery is waiting for food option selection."
        : result.success === false
        ? (result.actionRequired?.message || result.warning || "Browser Use demo needs attention before it can continue.")
        : isPortal
        ? "Browser Use patient portal automation reached its configured stopping point."
        : "DoorDash discovery reached its configured stopping point."
    });
    emit("browseruse.test", {
      mode: result.mode,
      sessionId: result.sessionId,
      taskId: result.taskId,
      liveUrl: result.liveUrl,
      warning: result.warning || null
    });
    return result;
  } catch (error) {
    updateTask(run.id, task.id, {
      status: "failed",
      stage: "Failed",
      error: error.message
    });
    updateRun(run.id, {
      status: "completed_with_errors",
      completedAt: new Date().toISOString(),
      summary: `Browser Use test failed: ${error.message}`
    });
    throw error;
  }
}

function isRecoverableBrowserHandoff(result) {
  const parsed = parseBrowserOutput(result.output);
  return result.mode === "blocked" ||
    result.actionRequired?.type === "auth" ||
    parsed?.auth_required === true ||
    /profile|login|sign in|oauth|verification|captcha|setup/i.test(`${result.output || ""} ${result.warning || ""}`);
}

function isRetryablePublicDiscoveryStop(result) {
  return /task was cancelled|stopped browser use session|timed out|cancelled/i.test(`${result.output || ""} ${result.warning || ""}`);
}

function parseBrowserOutput(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}
