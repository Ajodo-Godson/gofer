import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Browser } from "../../interfaces/Browser.js";
import { AdapterError } from "../../interfaces/AdapterError.js";
import { config } from "../../lib/config.js";

const MAX_STEPS = 10;

const SYSTEM_PROMPT = `You are a browser automation agent controlling a real web browser.

Given the current page state and a goal, respond with ONLY a valid JSON object — no markdown, no explanation, no code fences:
{"action":"<action>","params":{...},"reasoning":"<short reason>"}

Available actions:
  navigate  { "url": "https://..." }
  click     { "text": "exact or partial visible text of the link or button to click" }
  type      { "selector": "css selector of an INPUT or TEXTAREA field", "value": "text to type" }
  scroll    { "direction": "down" | "up" }
  done      { "result": "the answer or summary", "success": true | false }

Critical rules — read carefully:
1. If ANY part of the goal is answered by the current page content, call done IMMEDIATELY with what you found. Never click or navigate just to "confirm" something already visible.
2. type is ONLY for filling HTML form fields (inputs, textareas). Never use type to extract, record, or transcribe visible text.
3. click is for pressing buttons or following links to reach a page you haven't visited yet. Do not click to "read" something already on the page.
4. Keep reasoning under 8 words.
5. result MUST contain the actual answer text copied from the page — never just 'Done' or 'Found it'.
6. result and reasoning must not contain double-quote characters. Use single quotes or omit them.
7. Respond with compact one-line JSON only.`;

export async function createBrowser(options = {}) {
  if (config.playwright.enabled) {
    try {
      await import("playwright");
    } catch {
      throw new AdapterError(
        "unavailable",
        "PLAYWRIGHT_ENABLED is true but the playwright package could not be imported. Run: npm install playwright",
        { provider: "playwright" }
      );
    }
  }
  return new PlaywrightBrowser(options);
}

class PlaywrightBrowser extends Browser {
  async act(req) {
    if (!req?.prompt) {
      throw new AdapterError(
        "invalid",
        "Browser.act requires a prompt.",
        { provider: "playwright", errandId: req?.errandId }
      );
    }

    if (!config.playwright.enabled) {
      return {
        success: true,
        data: { simulated: true, prompt: req.prompt },
        artifacts: [],
        blocker: null
      };
    }

    let chromium;
    try {
      ({ chromium } = await import("playwright"));
    } catch {
      throw new AdapterError(
        "unavailable",
        "playwright package could not be imported.",
        { provider: "playwright", errandId: req.errandId }
      );
    }

    // launchPersistentContext persists cookies/storage across sessions; plain
    // launch() does not accept userDataDir (it's a context-level concept).
    let closeable;
    let context;
    try {
      if (config.playwright.userDataDir) {
        closeable = await chromium.launchPersistentContext(config.playwright.userDataDir, { headless: true });
        context = closeable;
      } else {
        closeable = await chromium.launch({ headless: true });
        context = await closeable.newContext();
      }
    } catch (error) {
      throw new AdapterError(
        "unavailable",
        `Playwright failed to launch browser: ${error.message}`,
        { provider: "playwright", errandId: req.errandId, cause: error }
      );
    }

    const artifacts = [];

    try {
      const page = await context.newPage();
      const errandSlug = (req.errandId || "snap").replace(/[^a-z0-9-]/gi, "-");

      // Navigate to any URL in the prompt before starting the AI loop.
      const urlMatch = req.prompt.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        await page.goto(urlMatch[0], { waitUntil: "domcontentloaded", timeout: 30000 });
      }

      // If Ollama is configured, run the AI action loop; otherwise fall back to
      // a single-page snapshot (title, url, blocker detection).
      if (config.ollama.model) {
        const loopResult = await runAILoop(page, req.prompt, artifacts, errandSlug);
        return {
          success: loopResult.success,
          data: { result: loopResult.result, url: page.url(), prompt: req.prompt },
          artifacts,
          blocker: loopResult.blocker || null
        };
      }

      // Fallback: no AI loop — snapshot current page.
      const blocker = await detectPageBlocker(page);
      const title = await page.title().catch(() => "");
      const url = page.url();

      await captureScreenshot(page, artifacts, `${errandSlug}-${Date.now()}`);

      return {
        success: !blocker,
        data: { title, url, prompt: req.prompt },
        artifacts,
        blocker
      };
    } catch (error) {
      return {
        success: false,
        data: { error: error.message },
        artifacts,
        blocker: null
      };
    } finally {
      await closeable.close().catch(() => null);
    }
  }

  async authSession(profileId) {
    if (!profileId) {
      throw new AdapterError(
        "invalid",
        "Browser.authSession requires a profileId.",
        { provider: "playwright" }
      );
    }

    if (!config.playwright.enabled || !config.playwright.userDataDir) {
      return { sessionId: `playwright-sim-${profileId}-${randomUUID().slice(0, 8)}` };
    }

    return { sessionId: `playwright-${profileId}-${randomUUID().slice(0, 8)}` };
  }
}

// ── AI action loop ────────────────────────────────────────────────────────────

async function runAILoop(page, goal, artifacts, errandSlug) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  let step = 0;

  while (step < MAX_STEPS) {
    const state = await getPageState(page);
    const label = step === 0 ? `Goal: ${goal}` : "Previous action completed.";

    messages.push({ role: "user", content: `${label}\n\nCurrent page:\n${state}` });

    let raw;
    try {
      raw = await askOllama(messages);
    } catch (err) {
      return { success: false, result: `Ollama error: ${err.message}`, blocker: null };
    }

    process.stdout.write(`  [model] ${raw.slice(0, 300)}\n`);

    messages.push({ role: "assistant", content: raw });

    let parsed;
    try {
      parsed = parseJSON(raw);
    } catch {
      return { success: false, result: `Model returned invalid JSON: ${raw.slice(0, 200)}`, blocker: null };
    }

    const { action, params = {}, reasoning } = parsed;
    process.stdout.write(`  step ${step + 1}: ${action} — ${reasoning}\n`);

    // Capture the page state the model saw when making this decision.
    await captureScreenshot(page, artifacts, `${errandSlug}-step${step + 1}-before`);

    if (action === "done") {
      return {
        success: params.success !== false,
        result: params.result || "Done.",
        blocker: params.blocker || null
      };
    }

    const actionResult = await executeAction(page, action, params);

    // Capture the page state after the action completes.
    await captureScreenshot(page, artifacts, `${errandSlug}-step${step + 1}-after`);

    // Feed the action result back so the model knows what happened.
    messages.push({ role: "user", content: `Action result: ${actionResult}` });

    step++;
  }

  return { success: false, result: `Reached max steps (${MAX_STEPS}) without completing goal.`, blocker: null };
}

async function askOllama(messages) {
  const resp = await fetch(`${config.ollama.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollama.model,
      messages,
      temperature: 0.1,
      max_tokens: 256,
      stream: false
    })
  });

  if (!resp.ok) {
    throw new Error(`Ollama ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json();
  return data.choices[0].message.content.trim();
}

function parseJSON(text) {
  const stripped = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();

  // 1. Direct parse (well-formed JSON).
  try { return JSON.parse(stripped); } catch {}

  // 2. Extract first {...} block and try again.
  const block = (stripped.match(/\{[\s\S]*\}/) || [])[0];
  if (block) { try { return JSON.parse(block); } catch {} }

  // 3. Regex-extract individual fields — handles unescaped quotes inside string values.
  const src = block || stripped;
  const action = (src.match(/"action"\s*:\s*"(\w+)"/) || [])[1];
  if (!action) throw new SyntaxError("Could not parse model response");

  const reasoning = (src.match(/"reasoning"\s*:\s*"([^"]*)"/) || [])[1] || "";
  const params = {};

  // Fixed-format param fields that should not contain quotes.
  for (const key of ["url", "direction", "selector", "value", "text"]) {
    const m = src.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    if (m) params[key] = m[1];
  }

  // result: capture everything between "result": " and the next unescaped ","success" or "}.
  const resultM = src.match(/"result"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
  if (resultM) params.result = resultM[1];

  const successM = src.match(/"success"\s*:\s*(true|false)/);
  if (successM) params.success = successM[1] === "true";

  return { action, params, reasoning };
}

async function getPageState(page) {
  const title = await page.title().catch(() => "");
  const url = page.url();

  const { bodyText, links, buttons, inputs } = await page.evaluate(() => {
    const bodyText = (document.body?.innerText || "").trim().slice(0, 2000);

    const links = [...document.querySelectorAll("a[href]")]
      .map(el => el.innerText.trim())
      .filter(Boolean)
      .slice(0, 20);

    const buttons = [...document.querySelectorAll("button, [role=button], input[type=submit]")]
      .map(el => el.innerText?.trim() || el.value || "")
      .filter(Boolean)
      .slice(0, 10);

    const inputs = [...document.querySelectorAll("input:not([type=hidden]), textarea")]
      .map(el => {
        const id = el.id;
        const label = id ? document.querySelector(`label[for="${id}"]`)?.innerText?.trim() : null;
        return label || el.placeholder || el.name || el.type || "input";
      })
      .filter(Boolean)
      .slice(0, 10);

    return { bodyText, links, buttons, inputs };
  }).catch(() => ({ bodyText: "", links: [], buttons: [], inputs: [] }));

  const parts = [`Title: ${title}`, `URL: ${url}`, `\nPage content:\n${bodyText}`];
  if (links.length) parts.push(`\nLinks: ${links.join(" | ")}`);
  if (buttons.length) parts.push(`Buttons: ${buttons.join(" | ")}`);
  if (inputs.length) parts.push(`Input fields: ${inputs.join(" | ")}`);

  return parts.join("\n");
}

async function executeAction(page, action, params) {
  try {
    switch (action) {
      case "navigate":
        await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(500);
        return `Navigated to ${params.url}`;

      case "click":
        if (params.text) {
          await page.getByText(params.text, { exact: false }).first().click({ timeout: 5000 });
        } else if (params.selector) {
          await page.click(params.selector, { timeout: 5000 });
        }
        await page.waitForTimeout(1000);
        return `Clicked "${params.text || params.selector}"`;

      case "type":
        await page.fill(params.selector, params.value ?? params.text ?? "");
        return `Typed into ${params.selector}`;

      case "scroll":
        await page.evaluate((dir) => {
          window.scrollBy(0, dir === "down" ? window.innerHeight * 0.8 : -window.innerHeight * 0.8);
        }, params.direction || "down");
        await page.waitForTimeout(400);
        return `Scrolled ${params.direction || "down"}`;

      default:
        return `Unknown action "${action}" — skipped`;
    }
  } catch (err) {
    return `${action} failed: ${err.message}`;
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function captureScreenshot(page, artifacts, label) {
  try {
    const buf = await page.screenshot({ fullPage: true });
    const dir = join(process.cwd(), "screenshots");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${label}-${Date.now()}.png`);
    await writeFile(filePath, buf);
    artifacts.push({ type: "screenshot", path: filePath });
  } catch {
    // Screenshot is best-effort; never throw.
  }
}

async function detectPageBlocker(page) {
  try {
    const content = await page.content();
    const lower = content.toLowerCase();

    if (/captcha|recaptcha|hcaptcha|cf-turnstile|challenge.*cloudflare/i.test(lower)) {
      return "captcha";
    }
    if (
      /sign in|log in|login|please authenticate|authentication required|access denied|you must be logged in/i.test(lower) &&
      !/sign out|log out|logout/i.test(lower)
    ) {
      return "login_required";
    }

    const heading = await page.evaluate(() => {
      const h = document.querySelector("h1,h2");
      return h ? h.textContent : "";
    }).catch(() => "");

    if (/404|not found|page not found/i.test(heading)) return "not_found";
    return null;
  } catch {
    return null;
  }
}
