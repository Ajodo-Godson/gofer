import { dispatchAgentJob } from "../agents/manager.js";
import { addArtifact, createRun, emit, updateRun, updateTask } from "./store.js";

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
    title: isPortal ? "Browser Use: fill Dr. Carl patient portal" : "Browser Use: build DoorDash cart",
    source: "GOFER",
    type: "browser_test",
    label: isPortal ? "Patient portal automation" : "Food-order cart automation",
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
    const result = await dispatchAgentJob("browser-recon", isPortal ? "patient-portal" : "doordash-cart", {}, {
      onProgress: (progress) => {
        if (progress.phase !== "browser-session-started" || !progress.liveUrl || liveArtifactAdded) return;
        liveArtifactAdded = true;
        addArtifact(run.id, task.id, {
          kind: "browser",
          title: isPortal ? "Browser Use live patient portal" : "Browser Use live DoorDash session",
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
      title: isPortal ? "Browser Use patient portal session" : "Browser Use DoorDash cart session",
      detail: result.mode === "blocked"
        ? "GOFER did not start Browser Use because this workflow needs a persistent authenticated profile first."
        : result.mode === "real"
        ? `Session ${result.sessionId} ${result.success === false ? "failed" : "completed"} ${isPortal ? "against the Dr. Carl patient portal" : "on DoorDash"}.`
        : "Browser Use fell back to local simulation.",
      liveUrl: result.liveUrl,
      output: result.output || result.data?.output || null,
      actionRequired: result.actionRequired || null,
      warning: result.warning || null
    });
    updateTask(run.id, task.id, {
      status: result.success === false ? "failed" : "completed",
      stage: result.success === false ? "Blocked or failed" : "Completed",
      error: result.success === false ? result.output || result.warning || "Browser Use did not complete the workflow." : null,
      result: result.success === false
        ? result.mode === "blocked"
          ? "Browser Use profile setup required before this workflow can run quickly."
          : "Browser Use did not complete the requested workflow. See the final artifact for the exact blocker."
        : result.mode === "real"
        ? isPortal
          ? "Real Browser Use session completed the patient portal workflow."
          : "Real Browser Use session completed or reached the DoorDash cart stopping point."
        : "Browser Use test completed in fallback mode."
    });
    updateRun(run.id, {
      status: "completed",
      completedAt: new Date().toISOString(),
      summary: isPortal
        ? "Browser Use patient portal automation started successfully."
        : "Browser Use DoorDash cart demo started successfully."
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
