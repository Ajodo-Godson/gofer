export async function importTasksFromSource({ text, url, sourceName }) {
  const sourceText = text?.trim() || await fetchSourceText(url);
  const tasks = parseTasks(sourceText);
  if (!tasks.length) {
    throw new Error("No actionable tasks found. Paste one task per line, or use checkbox/bullet lines from a public doc.");
  }
  return {
    source: sourceName || sourceLabel(url) || "Imported Tasks",
    tasks
  };
}

async function fetchSourceText(url) {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl) throw new Error("Paste tasks or provide a public document URL.");
  const parsed = new URL(cleanUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only public http/https document URLs are supported.");
  }

  const response = await fetch(parsed.href, {
    headers: {
      "User-Agent": "GOFER task importer"
    }
  });
  if (!response.ok) {
    throw new Error(`Could not read source document: HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();
  if (contentType.includes("text/html")) return htmlToText(body);
  return body;
}

function parseTasks(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(cleanTaskLine)
    .filter(Boolean)
    .slice(0, 25)
    .map((line, index) => ({
      id: `source-${Date.now()}-${index + 1}`,
      title: line.title,
      notes: line.notes,
      status: line.done ? "done" : "todo"
    }));
}

function cleanTaskLine(line) {
  const normalized = line
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (/^(notes?|todos?|tasks?|source of truth)$/i.test(normalized)) return null;

  const checkbox = normalized.match(/^(?:[-*]\s*)?\[(x| )\]\s+(.+)$/i);
  const bullet = normalized.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
  const raw = checkbox?.[2] || bullet?.[1] || normalized;
  if (raw.length < 4) return null;

  const [title, ...noteParts] = raw.split(/\s+-\s+|\s+—\s+|\s+:\s+/);
  return {
    title: title.trim(),
    notes: noteParts.join(" - ").trim(),
    done: checkbox?.[1]?.toLowerCase() === "x"
  };
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<(li|p|div|br|h[1-6]|tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"");
}

function sourceLabel(url) {
  if (!url) return null;
  try {
    const host = new URL(url).host.replace(/^www\./, "");
    if (host.includes("notion")) return "Notion";
    if (host.includes("docs.google")) return "Google Doc";
    return host;
  } catch {
    return null;
  }
}
