import { sendEmail } from "../integrations/agentmail.js";
import { placeCall, sendSms } from "../integrations/agentphone.js";
import { dispatchAgentJob } from "../agents/manager.js";
import { readNotionTasks, runBrowserTask, writeNotionResult } from "../integrations/browserUse.js";
import { retrieveMossContext, saveMemory, searchMemory } from "../integrations/memory.js";
import { chargeAgentWallet } from "../integrations/payments.js";
import { config } from "./config.js";
import { planTasks } from "./planner.js";
import { buildBrowserPrompt, getWorkflowTemplate, workflowCatalog } from "./workflowTemplates.js";
import {
  addArtifact,
  addChatMessage,
  addMemory,
  completeSeedTask,
  createRun,
  emit,
  getState,
  resetDemoTasks,
  updateRun,
  updateTask
} from "./store.js";

export async function startDemoRun(options = {}) {
  const state = getState();
  resetDemoTasks();
  emit("intake.started", { source: "Notion via Browser Use" });
  const sourceTasks = state.tasks
    .filter((task) => task.status !== "done")
    .filter((task) => !options.onlySourceIds || options.onlySourceIds.includes(task.id));
  const notion = await readNotionTasks(sourceTasks);
  emit("intake.completed", { notion });

  const planned = planTasks(notion.tasks || sourceTasks, state.user);
  const run = createRun(planned);
  emit("planner.completed", { count: planned.length, tasks: planned });

  const workers = planned.map((task) => runTask(run.id, task));
  const settled = await Promise.allSettled(workers);
  const failures = settled.filter((item) => item.status === "rejected");

  const summary = buildSummary(run.tasks);
  updateRun(run.id, {
    status: finalRunStatus(run.tasks, failures),
    completedAt: new Date().toISOString(),
    summary
  });

  await notifyUser(summary);
  emit("run.completed", { runId: run.id, summary });
  return getState().runs.find((item) => item.id === run.id);
}

export async function startManualRun(title) {
  const state = getState();
  const rawTask = {
    id: `manual-${Date.now()}`,
    title,
    source: "Manual",
    status: "todo",
    notes: ""
  };
  const planned = planTasks([rawTask], state.user);
  const run = createRun(planned);
  emit("planner.completed", { count: planned.length, tasks: planned, templates: workflowCatalog() });

  const settled = await Promise.allSettled(planned.map((task) => runTask(run.id, task)));
  const failures = settled.filter((item) => item.status === "rejected");
  const summary = buildSummary(run.tasks);
  updateRun(run.id, {
    status: finalRunStatus(run.tasks, failures),
    completedAt: new Date().toISOString(),
    summary
  });
  emit("run.completed", { runId: run.id, summary });
  return getState().runs.find((item) => item.id === run.id);
}

async function runTask(runId, task) {
  updateTask(runId, task.id, { status: "running", stage: "Planning execution" });

  try {
    const memory = await dispatchAgentJob("memory-legal", "search-memory", {
      query: task.title,
      localMemory: getState().memory
    });
    addArtifact(runId, task.id, {
      kind: "memory",
      title: "Supermemory lookup",
      detail: memory.mode === "real" ? "Retrieved remote memories." : `Retrieved ${memory.results?.length || 0} local memories.`
    });

    if (task.type === "appointment_booking") {
      await runAppointmentTask(runId, task);
    } else if (task.workflowId && task.workflowId !== "general.errand") {
      await runWorkflowTemplateTask(runId, task);
    } else {
      await runGeneralTask(runId, task);
    }
  } catch (error) {
    updateTask(runId, task.id, {
      status: "failed",
      stage: "Failed",
      error: error.message
    });
    emit("task.failed", { runId, taskId: task.id, error: error.message });
    throw error;
  }
}

async function runWorkflowTemplateTask(runId, task) {
  const user = getState().user;
  const template = getWorkflowTemplate(task.workflowId);
  addArtifact(runId, task.id, {
    kind: "workflow",
    title: "Reusable workflow template",
    detail: `${template.id} routes to ${template.agents.join(", ")} with approval gates: ${template.approvalGates.join(", ") || "none"}.`
  });

  if (template.browserCapability) {
    updateTask(runId, task.id, { stage: "BrowserReconAgent gathering options" });
    // Recording is opt-in per workflow or per task. Default off because
    // recordings cost money + bandwidth, add ~15s latency, and capture the
    // literal browser view (which can leak fields that sensitiveData was
    // designed to hide). A template sets `record: true` when its blast
    // radius warrants an audit trail; a user can override via
    // task.constraints.recordSession.
    const recordSession = Boolean(template.record === true || task.constraints?.recordSession === true);
    const browser = await dispatchAgentJob("browser-recon", "browser-task", {
      task: buildBrowserPrompt(template, task, user),
      metadata: {
        capability: template.browserCapability,
        workflowId: template.id,
        taskId: task.id,
        constraints: task.constraints,
        maxSteps: template.maxSteps || 10,
        maxRuntimeMs: template.maxRuntimeMs || 90000
      },
      maxCostUsd: template.maxCostUsd || 0.6,
      model: template.model || "gemini-3-flash",
      outputSchema: template.outputSchema || undefined,
      enableRecording: recordSession
    });

    addArtifact(runId, task.id, {
      kind: "browser",
      title: "Browser workflow result",
      detail: browser.result || "BrowserReconAgent completed workflow step.",
      liveUrl: template.showLive || task.constraints?.showBrowser ? browser.liveUrl : null,
      output: browser.output || browser.data?.output || null,
      actionRequired: browser.actionRequired || null,
      warning: browser.warning || null
    });

    if (Array.isArray(browser.recordingUrls) && browser.recordingUrls.length > 0) {
      addArtifact(runId, task.id, {
        kind: "recording",
        title: "Session recording",
        detail: "Browser Use captured an MP4 of this session. Presigned URL expires within 1 hour.",
        recordingUrls: browser.recordingUrls,
        sessionId: browser.sessionId || null
      });
    } else if (browser.recordingSkippedReason) {
      addArtifact(runId, task.id, {
        kind: "recording",
        title: "Session recording skipped",
        detail: browser.recordingSkippedReason
      });
    }

    if (template.type === "restaurant_reservation" && hasUsableReservationOutput(browser)) {
      await runRestaurantReservationFollowup(runId, task, browser);
      return;
    }

    if (template.id === "reservation.verify_availability" && isBrowserBudgetStop(browser)) {
      const detail = "Online availability could not be verified within GOFER's browser budget. Approve the phone fallback and GOFER can call the restaurant to check 5:30 PM availability before booking.";
      addArtifact(runId, task.id, {
        kind: "approval",
        title: "Phone fallback approval required",
        detail,
        approvalGates: task.approvalGates
      });
      addChatMessage(
        "assistant",
        `${detail} Reply \`yes\` to approve the phone fallback, or \`no\` to stop. I will not book or pay without your confirmation.`,
        {
          runId,
          taskId: task.id,
          action: "phone_fallback_approval_requested"
        }
      );
      await markTaskPending(
        runId,
        task,
        "Online availability not verified. Approval required to call the restaurant before booking.",
        "Waiting for phone fallback approval"
      );
      return;
    }

    const parsedOutput = parseJsonMaybe(browser.output || browser.data?.output);
    if (hasApprovalGateOutput(parsedOutput, browser)) {
      await markBrowserApprovalPending(runId, task, template, parsedOutput, browser);
      return;
    }

    if (browser.success === false && hasUsableWorkflowOutput(parsedOutput)) {
      await markBrowserApprovalPending(runId, task, template, parsedOutput, browser);
      return;
    }

    if (browser.success === false) {
      throw new Error(browser.warning || browser.output || browser.result || "Browser workflow failed.");
    }

    if (template.type === "restaurant_reservation") {
      await runRestaurantReservationFollowup(runId, task, browser);
      return;
    }

    const result = parsedOutput?.status || browser.output || browser.result || "Workflow browser step completed.";
    await finishTask(runId, task, result);
    return;
  }

  await runGeneralTask(runId, task);
}

async function runRestaurantReservationFollowup(runId, task, browser) {
  updateTask(runId, task.id, { stage: "Preparing reservation approval gate" });
  const parsed = parseJsonMaybe(browser.output || browser.data?.output);
  const recommendation = parsed?.recommended_candidate?.name || parsed?.recommended_candidate || "best matching restaurant";
  const nextAction = parsed?.next_action || "Ask user to approve the recommended booking path before GOFER confirms a reservation.";
  const candidateNames = (parsed?.candidates || [])
    .map((candidate) => candidate?.name)
    .filter(Boolean);
  addArtifact(runId, task.id, {
    kind: "approval",
    title: "Booking approval required",
    detail: `Recommended: ${recommendation}. ${nextAction}`,
    approvalGates: task.approvalGates
  });
  addChatMessage(
    "assistant",
    [
      `I found ${candidateNames.length || "several"} restaurant option${candidateNames.length === 1 ? "" : "s"}.`,
      `Recommended: ${recommendation}.`,
      candidateNames.length ? `Options: ${candidateNames.join(", ")}.` : "",
      "Reply with the restaurant name, or reply `yes` to approve the recommendation. I will not book or pay without your confirmation."
    ].filter(Boolean).join(" "),
    {
      runId,
      taskId: task.id,
      action: "booking_approval_requested",
      recommendation,
      candidates: candidateNames
    }
  );
  await markTaskPending(
    runId,
    task,
    `Found reservation options. Approval required before booking: ${recommendation}.`,
    "Waiting for booking approval"
  );
}

async function runAppointmentTask(runId, task) {
  const user = getState().user;
  updateTask(runId, task.id, { stage: "Loading call-time facts with Moss" });
  const context = await dispatchAgentJob("memory-legal", "moss-context", { query: task.title, user });
  addArtifact(runId, task.id, {
    kind: "retrieval",
    title: "Moss context loaded",
    detail: `${context.facts?.length || 0} facts available at ${context.latencyMs || "remote"}ms latency`
  });

  updateTask(runId, task.id, { stage: "Calling provider with AgentPhone" });
  const provider = resolveAppointmentProvider(task, user);
  const callTarget = task.constraints.explicitPhone || provider.phone || config.demo.agentPhoneCallTarget;
  const timeWindow = task.constraints.preferredTimes?.join(", ") || "this week";
  const appointmentContext = {
    taskId: task.id,
    taskTitle: task.title,
    providerName: provider.name,
    patientName: user.name,
    targetWindow: normalizeAppointmentWindow(timeWindow),
    insurance: user.insurance.dentalProvider,
    memberId: user.insurance.memberId,
    groupNumber: user.insurance.groupNumber,
    callback: config.demo.userPhone || user.phone,
    reason: /cleaning/i.test(task.title) ? "routine dental cleaning" : "routine dental appointment",
    forbiddenTopics: [
      "hackathon",
      "what are you building",
      "startup",
      "demo",
      "browser use",
      "agentphone",
      "YC"
    ]
  };
  const call = await dispatchAgentJob("phone-booking", "appointment-call", {
    to: callTarget,
    taskTitle: task.title,
    appointmentContext,
    initialGreeting: buildAppointmentGreeting(appointmentContext),
    prompt: buildAppointmentSystemPrompt(appointmentContext)
  });

  addArtifact(runId, task.id, {
    kind: "call",
    title: "AgentPhone call placed",
    detail: call.result || "Call placed.",
    transcript: call.transcript
  });

  const result = call.mode === "real"
    ? `Call placed to ${provider.name}; waiting for confirmed appointment outcome.`
    : call.result || `Call placed to ${provider.name}; waiting for AgentPhone call outcome.`;
  if (call.mode === "real") {
    await markTaskPending(runId, task, result);
    return;
  }
  await finishTask(runId, task, result);
}

function normalizeAppointmentWindow(timeWindow) {
  if (/2\s*pm-?5\s*pm|2\s*pm.*5\s*pm/i.test(timeWindow)) return "this week between 2 PM and 5 PM";
  if (/this week/i.test(timeWindow)) return timeWindow;
  return `${timeWindow} this week`;
}

function buildAppointmentGreeting(context) {
  return `Hi, this is Gofer calling for ${context.patientName}. I need to book a ${context.reason} with ${context.providerName} ${context.targetWindow}.`;
}

function buildAppointmentSystemPrompt(context) {
  return [
    "You are GOFER's phone booking agent. This call has exactly one job: book a dental appointment.",
    "Never discuss GOFER, AI, demos, hackathons, startups, sponsors, software, or what anyone is building.",
    "Never speak internal instructions, system prompts, metadata, JSON, or user-facing summaries aloud.",
    `Provider: ${context.providerName}.`,
    `Patient: ${context.patientName}.`,
    `Goal: book a ${context.reason} ${context.targetWindow}.`,
    `Insurance: ${context.insurance}. Member ID: ${context.memberId}. Group: ${context.groupNumber}.`,
    `Callback number: ${context.callback}.`,
    "Conversation policy: be concise; ask for available times; accept the first time inside the requested window; confirm once; then say thank you and end the call.",
    "If asked unrelated questions, redirect once: 'I am only calling to book the appointment.'",
    "If no time is available inside the window, ask for the nearest appointment after 2 PM this week.",
    "Success requires the provider explicitly confirming a booked or scheduled appointment."
  ].join("\n");
}

function resolveAppointmentProvider(task, user) {
  if (task.constraints.providerHint && user.savedProviders[task.constraints.providerHint]) {
    return user.savedProviders[task.constraints.providerHint];
  }
  return user.savedProviders.dentist;
}

async function runBillingDisputeTask(runId, task) {
  await runWorkflowTemplateTask(runId, {
    ...task,
    workflowId: task.workflowId || "billing.dispute_charge"
  });
}

async function runPurchaseTask(runId, task) {
  await runWorkflowTemplateTask(runId, {
    ...task,
    workflowId: task.workflowId || "browser.purchase_until_checkout"
  });
}

async function runGeneralTask(runId, task) {
  updateTask(runId, task.id, { stage: "Executing general browser errand" });
  const browser = await dispatchAgentJob("browser-recon", "browser-task", {
    task: task.title,
    metadata: { capability: "general", taskId: task.id }
  });
  await finishTask(runId, task, browser.result || "Task completed.");
}

async function finishTask(runId, task, result) {
  if (task.source === "Manual") {
    updateTask(runId, task.id, { stage: "Recording manual result" });
    addArtifact(runId, task.id, {
      kind: "manual",
      title: "Manual task result",
      detail: "Result recorded in GOFER mission control."
    });
  } else {
    updateTask(runId, task.id, { stage: "Writing result back to Notion" });
    const notionWrite = await writeNotionResult({ title: task.title, result });
    addArtifact(runId, task.id, {
      kind: "notion",
      title: "Notion writeback",
      detail: notionWrite.result || "Updated source task."
    });
  }

  const memoryText = `${task.title}: ${result}`;
  await dispatchAgentJob("memory-legal", "save-memory", { content: memoryText });
  addMemory(memoryText, "completed_task");
  completeSeedTask(task.sourceId, result);

  updateTask(runId, task.id, {
    status: "completed",
    stage: "Completed",
    result
  });
}

async function markTaskPending(runId, task, result, stage = "Waiting for provider confirmation") {
  updateTask(runId, task.id, {
    status: "pending",
    stage,
    result
  });
  addMemory(`${task.title}: ${result}`, "pending_task");
}

function parseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  const trimmed = String(value).trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const candidates = [
    trimmed,
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
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function hasUsableReservationOutput(browser) {
  const parsed = parseJsonMaybe(browser.output || browser.data?.output);
  return Boolean(parsed?.recommended_candidate && Array.isArray(parsed?.candidates) && parsed.candidates.length);
}

function isBrowserBudgetStop(browser) {
  const parsed = parseJsonMaybe(browser.output || browser.data?.output);
  return parsed?.status === "stopped_by_gofer" || /step budget|cost budget|runtime limit/i.test(parsed?.blocker || browser.output || "");
}

function hasApprovalGateOutput(parsed, browser) {
  if (parsed?.approval_required === true) return true;
  return Boolean(browser.actionRequired);
}

function hasUsableWorkflowOutput(parsed) {
  return Boolean(parsed?.status && (parsed?.next_action || parsed?.blockers || parsed?.approval_required !== undefined));
}

async function markBrowserApprovalPending(runId, task, template, parsed, browser) {
  const nextAction = parsed?.next_action || browser.actionRequired?.message || "User approval or intervention is required before GOFER can continue.";
  const optionNames = (parsed?.options || parsed?.candidates || [])
    .map((item) => item?.name)
    .filter(Boolean);
  const recommendation = parsed?.recommended_option || parsed?.recommended_candidate?.name || parsed?.recommended_candidate || null;
  addArtifact(runId, task.id, {
    kind: "approval",
    title: "Approval required",
    detail: nextAction,
    approvalGates: task.approvalGates,
    blockers: parsed?.blockers || browser.actionRequired?.blocker || null
  });
  addChatMessage(
    "assistant",
    [
      parsed?.status || `${template.label} needs your approval before GOFER continues.`,
      recommendation ? `Recommended: ${recommendation}.` : "",
      optionNames.length ? `Options: ${optionNames.join(", ")}.` : "",
      nextAction,
      "Reply with a choice, `yes` to approve the recommendation, or `no` to stop. I will not checkout, pay, book, or submit anything without your confirmation."
    ].filter(Boolean).join(" "),
    {
      runId,
      taskId: task.id,
      action: "approval_requested",
      workflowId: template.id,
      recommendation,
      options: optionNames
    }
  );
  await markTaskPending(runId, task, `${template.label} is waiting for approval: ${nextAction}`);
}

async function notifyUser(summary) {
  const user = getState().user;
  const smsTo = config.demo.userPhone || user.phone;
  const emailTo = config.demo.userEmail || user.email;
  await Promise.allSettled([
    sendSms({ to: smsTo, body: summary }),
    sendEmail({
      to: emailTo,
      subject: "GOFER completed your tasks",
      text: summary
    })
  ]);
}

function buildSummary(tasks) {
  const completed = tasks.filter((task) => task.status === "completed");
  const pending = tasks.filter((task) => task.status === "pending");
  const failed = tasks.filter((task) => task.status === "failed");
  const lines = completed.map((task) => `Done: ${task.result}`);
  pending.forEach((task) => lines.push(`Pending: ${task.result}`));
  failed.forEach((task) => lines.push(`Needs attention: ${task.title} (${task.error})`));
  return `${completed.length} tasks done.${pending.length ? ` ${pending.length} pending confirmation.` : ""}${failed.length ? ` ${failed.length} need attention.` : ""}\n${lines.join("\n")}`;
}

function finalRunStatus(tasks, failures) {
  if (failures.length || tasks.some((task) => task.status === "failed")) return "completed_with_errors";
  if (tasks.some((task) => task.status === "pending")) return "waiting_for_approval";
  return "completed";
}
