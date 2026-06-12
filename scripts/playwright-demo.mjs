/**
 * Playwright + Ollama browser agent demo.
 * The AI loop navigates real websites, takes per-step screenshots, and prints results.
 *
 * Run:
 *   node --env-file=.env scripts/playwright-demo.mjs
 *
 * Requires in .env:
 *   PLAYWRIGHT_ENABLED=true
 *   OLLAMA_MODEL=llama3.1   (default, change to match your pulled model)
 */

import { createBrowser } from "../src/adapters/browser/playwright.js";

const tasks = [
  {
    label: "hn-top-story",
    prompt: "Visit https://news.ycombinator.com. Find the #1 ranked story on the front page and click its title link to open the actual article. Then tell me the title of the article page you landed on and its URL."
  },
  {
    label: "github-trending",
    prompt: "Visit https://github.com/trending and tell me the name and description of the top trending repository today."
  },
  {
    label: "httpbin-json",
    prompt: "Visit https://httpbin.org/json and read the slideshow title from the JSON response."
  }
];

const browser = await createBrowser();

for (const task of tasks) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Task: ${task.prompt}`);
  console.log(`${"─".repeat(60)}`);

  const result = await browser.act({ prompt: task.prompt, errandId: task.label });

  console.log(`\nResult:  ${result.data.result || result.data.title || "(no result)"}`);
  console.log(`Success: ${result.success}`);
  if (result.blocker) console.log(`Blocker: ${result.blocker}`);

  for (const a of result.artifacts) {
    if (a.type === "screenshot") console.log(`  📸 ${a.path}`);
  }
}

console.log(`\n${"═".repeat(60)}`);
console.log("Done. Open screenshots/ to see step-by-step captures.");
