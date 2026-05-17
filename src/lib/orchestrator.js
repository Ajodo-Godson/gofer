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
    status: failures.length ? "completed_with_errors" : "completed",
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
    status: failures.length ? "completed_with_errors" : "completed",
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
    } else if (task.type === "billing_dispute") {
      await runBillingDisputeTask(runId, task);
    } else if (task.type === "purchase") {
      await runPurchaseTask(runId, task);
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
      outputSchema: template.outputSchema || undefined
    });

    addArtifact(runId, task.id, {
      kind: "browser",
      title: "Browser workflow result",
      detail: browser.result || "BrowserReconAgent completed workflow step.",
      liveUrl: template.showLive ? browser.liveUrl : null,
      output: browser.output || browser.data?.output || null,
      actionRequired: browser.actionRequired || null,
      warning: browser.warning || null
    });

    if (browser.success === false) {
      throw new Error(browser.warning || browser.output || browser.result || "Browser workflow failed.");
    }

    if (template.type === "restaurant_reservation") {
      await runRestaurantReservationFollowup(runId, task, browser);
      return;
    }

    const result = browser.actionRequired
      ? `Ready for user approval: ${browser.actionRequired.message}`
      : browser.output || browser.result || "Workflow browser step completed.";
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
  addArtifact(runId, task.id, {
    kind: "approval",
    title: "Booking approval required",
    detail: `Recommended: ${recommendation}. ${nextAction}`,
    approvalGates: task.approvalGates
  });
  await finishTask(runId, task, `Found reservation options. Approval required before booking: ${recommendation}.`);
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
  const call = await dispatchAgentJob("phone-booking", "appointment-call", {
    to: callTarget,
    taskTitle: task.title,
    initialGreeting: `Hi, this is Gofer calling for ${user.name}. I wanted to book a dental appointment this week between 2 and 5 PM.`,
    prompt: `Call ${provider.name} at ${callTarget} to book a dental appointment for ${user.name}. Required time window: ${timeWindow}. Use ${user.insurance.dentalProvider}, member ${user.insurance.memberId}, group ${user.insurance.groupNumber}. Notes: ${task.constraints.notes}`
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
  await finishTask(runId, task, result);
}

function resolveAppointmentProvider(task, user) {
  if (task.constraints.providerHint && user.savedProviders[task.constraints.providerHint]) {
    return user.savedProviders[task.constraints.providerHint];
  }
  return user.savedProviders.dentist;
}

async function runBillingDisputeTask(runId, task) {
  updateTask(runId, task.id, { stage: "Operating authenticated portal with Browser Use" });
  const browser = await dispatchAgentJob("browser-recon", "browser-task", {
    task: "Open the authenticated utility portal, find the duplicated $47 charge, submit a dispute, and capture confirmation.",
    metadata: { capability: "billing-dispute", taskId: task.id }
  });

  addArtifact(runId, task.id, {
    kind: "browser",
    title: "Browser Use portal action",
    detail: browser.result,
    steps: browser.steps,
    confirmation: browser.confirmation
  });

  await finishTask(runId, task, `${browser.result} Ref ${browser.confirmation || "pending"}.`);
}

async function runPurchaseTask(runId, task) {
  updateTask(runId, task.id, { stage: "Checking spending policy" });
  const amount = 55;
  const user = getState().user;
  if (amount > user.spendingPolicy.autoApproveUnder) {
    addArtifact(runId, task.id, {
      kind: "approval",
      title: "Auto-approved by policy",
      detail: `$${amount} is under the $${user.spendingPolicy.autoApproveUnder} limit.`
    });
  }

  updateTask(runId, task.id, { stage: "Completing checkout with Browser Use" });
  const browser = await dispatchAgentJob("browser-recon", "browser-task", {
    task: "Order peony flowers for Mom's birthday, delivery June 4, using the agent wallet virtual card.",
    metadata: { capability: "purchase", taskId: task.id }
  });

  updateTask(runId, task.id, { stage: "Paying from Sponge wallet" });
  const payment = await dispatchAgentJob("payment", "wallet-charge", {
    amount: browser.amount || amount,
    description: task.title
  });

  addArtifact(runId, task.id, {
    kind: "payment",
    title: "Sponge wallet payment",
    detail: `$${payment.amount} paid from agent wallet.`,
    payment
  });

  addArtifact(runId, task.id, {
    kind: "browser",
    title: "Browser Use checkout",
    detail: browser.result,
    steps: browser.steps,
    confirmation: browser.confirmation
  });

  await finishTask(runId, task, `${browser.result} Confirmation ${browser.confirmation || "pending"}.`);
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
  const failed = tasks.filter((task) => task.status === "failed");
  const lines = completed.map((task) => `Done: ${task.result}`);
  failed.forEach((task) => lines.push(`Needs attention: ${task.title} (${task.error})`));
  return `${completed.length} tasks done.${failed.length ? ` ${failed.length} need attention.` : ""}\n${lines.join("\n")}`;
}
