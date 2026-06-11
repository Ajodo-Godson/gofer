import { randomUUID } from "node:crypto";
import { Browser } from "../../interfaces/Browser.js";
import { AdapterError } from "../../interfaces/AdapterError.js";
import { config } from "../../lib/config.js";

export async function createBrowser(options = {}) {
  // If PLAYWRIGHT_ENABLED=true, verify playwright is importable.
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

    // Simulation mode: PLAYWRIGHT_ENABLED is not true or playwright not configured.
    if (!config.playwright.enabled) {
      return {
        success: true,
        data: { simulated: true, prompt: req.prompt },
        artifacts: [],
        blocker: null
      };
    }

    // Real browser mode.
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

    const launchOptions = { headless: true };
    if (config.playwright.userDataDir) {
      launchOptions.userDataDir = config.playwright.userDataDir;
    }

    let browser;
    try {
      browser = await chromium.launch(launchOptions);
    } catch (error) {
      throw new AdapterError(
        "unavailable",
        `Playwright failed to launch browser: ${error.message}`,
        { provider: "playwright", errandId: req.errandId, cause: error }
      );
    }

    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      // Extract a URL from the prompt if present, otherwise use a default.
      const urlMatch = req.prompt.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        await page.goto(urlMatch[0], { waitUntil: "domcontentloaded", timeout: 30000 });
      }

      // Detect common blockers from the page.
      const blocker = await detectPageBlocker(page);

      const title = await page.title().catch(() => "");
      const url = page.url();

      return {
        success: !blocker,
        data: { title, url, prompt: req.prompt },
        artifacts: [],
        blocker
      };
    } catch (error) {
      return {
        success: false,
        data: { error: error.message },
        artifacts: [],
        blocker: null
      };
    } finally {
      await browser.close().catch(() => null);
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
      // Simulation mode or no persistent profile configured.
      return { sessionId: `playwright-sim-${profileId}-${randomUUID().slice(0, 8)}` };
    }

    // Real mode: the userDataDir IS the persistent session for this profile.
    return { sessionId: `playwright-${profileId}-${randomUUID().slice(0, 8)}` };
  }
}

/**
 * Inspect the current page content for login walls and CAPTCHA signals.
 * Returns the blocker kind or null if none detected.
 */
async function detectPageBlocker(page) {
  try {
    const content = await page.content();
    const lower = content.toLowerCase();

    if (
      /captcha|recaptcha|hcaptcha|cf-turnstile|challenge.*cloudflare/i.test(lower)
    ) {
      return "captcha";
    }

    if (
      /sign in|log in|login|please authenticate|authentication required|access denied|you must be logged in/i.test(lower) &&
      !/sign out|log out|logout/i.test(lower)
    ) {
      return "login_required";
    }

    const status = await page.evaluate(() => {
      const h1 = document.querySelector("h1,h2");
      return h1 ? h1.textContent : "";
    }).catch(() => "");

    if (/404|not found|page not found/i.test(status)) {
      return "not_found";
    }

    return null;
  } catch {
    return null;
  }
}
