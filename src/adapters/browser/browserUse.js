import { Browser } from "../../interfaces/Browser.js";
import { AdapterError } from "../../interfaces/AdapterError.js";
import { config } from "../../lib/config.js";
import { runBrowserTask } from "../../integrations/browserUse.js";

export async function createBrowser() {
  if (!config.browserUse.apiKey && !config.demo.mode) {
    throw new AdapterError(
      "unavailable",
      "Browser Use adapter requires BROWSER_USE_API_KEY",
      { provider: "browserUse" }
    );
  }
  return new BrowserUseBrowser();
}

class BrowserUseBrowser extends Browser {
  async act(req) {
    if (!req?.prompt) {
      throw new AdapterError(
        "invalid",
        "Browser.act requires a prompt.",
        { provider: "browserUse", errandId: req?.errandId }
      );
    }

    let result;
    try {
      result = await runBrowserTask({
        task: req.prompt,
        outputSchema: req.schema || undefined,
        metadata: {
          errandId: req.errandId,
          profileId: req.profileId || undefined
        }
      });
    } catch (error) {
      throw new AdapterError(
        "unknown",
        `Browser Use act failed: ${error.message}`,
        { provider: "browserUse", errandId: req.errandId, cause: error }
      );
    }

    const blocker = normalizeBlocker(result);
    return {
      success: result.success ?? true,
      data: parseOutput(result.output),
      artifacts: result.recordingUrls || [],
      blocker
    };
  }

  async authSession(profileId) {
    if (!profileId) {
      throw new AdapterError(
        "invalid",
        "Browser.authSession requires a profileId.",
        { provider: "browserUse" }
      );
    }

    // Browser Use exposes persistent profiles; a profile IS a session.
    // Return the configured or supplied profileId as the sessionId.
    return { sessionId: profileId };
  }
}

function normalizeBlocker(result) {
  const action = result.actionRequired;
  if (!action) return null;
  if (action.type === "auth") return "login_required";
  if (action.type === "captcha") return "captcha";
  if (action.type === "not_found") return "not_found";
  // Capacity / retry issues don't map to a standard blocker
  return null;
}

function parseOutput(output) {
  if (!output) return null;
  if (typeof output === "object") return output;
  const text = String(output).trim();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
