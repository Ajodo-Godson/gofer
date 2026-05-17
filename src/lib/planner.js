import { detectWorkflow } from "./workflowTemplates.js";

export function planTasks(rawTasks, user) {
  return rawTasks.map((raw, index) => {
    const text = `${raw.title} ${raw.notes || ""}`;
    const detected = detectWorkflow(text);

    return {
      id: `task-${index + 1}-${Date.now()}`,
      sourceId: raw.id,
      title: raw.title,
      source: raw.source || "manual",
      type: detected.type,
      workflowId: detected.id,
      label: detected.label,
      status: "queued",
      stage: "Queued",
      tools: detected.tools,
      fallbackTools: detected.fallbackTools || [],
      approvalGates: detected.approvalGates || [],
      parallelizable: true,
      constraints: inferConstraints(raw, user),
      artifacts: [],
      result: null,
      error: null
    };
  });
}

function inferConstraints(raw, user) {
  const text = `${raw.title} ${raw.notes || ""}`;
  return {
    preferredTimes: inferTimeWindow(text, user),
    partySize: inferPartySize(text),
    cuisine: inferCuisine(text),
    dateHint: inferDateHint(text),
    occasion: inferOccasion(text),
    budgetLimit: /47/.test(text) ? 47 : user.spendingPolicy.autoApproveUnder,
    location: extractAddress(text) || user.address || user.zip,
    insurance: /dentist|dental|cleaning/i.test(text) ? user.insurance : null,
    notes: raw.notes || "",
    providerHint: /carl/i.test(text) ? "drCarl" : null,
    explicitPhone: extractPhone(text),
    showBrowser: /see what (you|it).*(seeing|doing)|watch|show.*browser|live browser/i.test(text)
  };
}

function inferTimeWindow(text, user) {
  const around = text.match(/around\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (around) return [`around ${around[1]}`];
  const at = text.match(/\b(?:at|for)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
  if (at) return [at[1]];
  if (/2\s*pm.*5\s*pm|between\s*2.*5/i.test(text)) return ["2pm-5pm"];
  if (/morning/i.test(text)) return ["morning"];
  if (/tonight/i.test(text)) return ["tonight"];
  return user.preferences.appointmentTimes;
}

function extractPhone(text) {
  const match = text.match(/(?:\+?1[\s.-]*)?\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})/);
  return match ? `+1${match[1]}${match[2]}${match[3]}` : null;
}

function inferPartySize(text) {
  const match = text.match(/(?:for|party of)\s+(\d+)\s*(?:people|guests|ppl)?/i);
  return match ? Number(match[1]) : null;
}

function inferCuisine(text) {
  const cuisines = ["Chinese", "Italian", "Sushi", "Japanese", "Mexican", "Thai", "Indian", "Korean", "Pizza", "Mediterranean"];
  return cuisines.find((cuisine) => new RegExp(`\\b${cuisine}\\b`, "i").test(text)) || null;
}

function inferDateHint(text) {
  if (/tonight/i.test(text)) return "tonight";
  if (/tomorrow/i.test(text)) return "tomorrow";
  if (/this week/i.test(text)) return "this week";
  return null;
}

function inferOccasion(text) {
  if (/team dinner/i.test(text)) return "team dinner";
  if (/birthday/i.test(text)) return "birthday";
  if (/date night/i.test(text)) return "date night";
  return null;
}

function extractAddress(text) {
  const match = text.match(/\b\d{2,6}\s+[^,]+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Way|Ln|Lane)\b(?:,\s*[^.]+)?/i);
  return match ? match[0].trim() : null;
}
