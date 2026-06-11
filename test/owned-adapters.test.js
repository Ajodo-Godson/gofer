/**
 * Tests for the owned Playwright browser adapter and Gmail mailer adapter.
 *
 * All tests run in simulation mode (no PLAYWRIGHT_ENABLED, no GMAIL_USER /
 * GMAIL_APP_PASSWORD) so no real browser or email server is required.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { AdapterError } from "../src/interfaces/AdapterError.js";
import { Browser } from "../src/interfaces/Browser.js";
import { Mailer } from "../src/interfaces/Mailer.js";

// ---------------------------------------------------------------------------
// Playwright browser adapter
// ---------------------------------------------------------------------------

test("playwright adapter: createBrowser returns a Browser subclass instance", async () => {
  const { createBrowser } = await import("../src/adapters/browser/playwright.js");
  assert.equal(typeof createBrowser, "function");
  const browser = await createBrowser();
  assert.ok(browser instanceof Browser, "should be a Browser instance");
});

test("playwright adapter: act() in simulation mode returns { success: true, blocker: null }", async () => {
  const { createBrowser } = await import("../src/adapters/browser/playwright.js");
  const browser = await createBrowser();
  const result = await browser.act({ prompt: "test", errandId: "e1" });
  assert.equal(result.success, true);
  assert.equal(result.blocker, null);
});

test("playwright adapter: act() throws AdapterError when prompt is missing", async () => {
  const { createBrowser } = await import("../src/adapters/browser/playwright.js");
  const browser = await createBrowser();
  await assert.rejects(
    browser.act({ errandId: "e1" }),
    (error) => {
      assert.ok(error instanceof AdapterError, "should throw AdapterError");
      assert.equal(error.kind, "invalid");
      assert.equal(error.provider, "playwright");
      return true;
    }
  );
});

test("playwright adapter: authSession() returns object with sessionId string", async () => {
  const { createBrowser } = await import("../src/adapters/browser/playwright.js");
  const browser = await createBrowser();
  const session = await browser.authSession("profile-1");
  assert.equal(typeof session.sessionId, "string");
  assert.ok(session.sessionId.length > 0, "sessionId must be non-empty");
});

test("playwright adapter: authSession() throws AdapterError when profileId is missing", async () => {
  const { createBrowser } = await import("../src/adapters/browser/playwright.js");
  const browser = await createBrowser();
  await assert.rejects(
    browser.authSession(""),
    (error) => {
      assert.ok(error instanceof AdapterError, "should throw AdapterError");
      assert.equal(error.kind, "invalid");
      assert.equal(error.provider, "playwright");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// Gmail mailer adapter
// ---------------------------------------------------------------------------

test("gmail adapter: createMailer returns a Mailer subclass instance", async () => {
  const { createMailer } = await import("../src/adapters/mail/gmail.js");
  assert.equal(typeof createMailer, "function");
  const mailer = await createMailer();
  assert.ok(mailer instanceof Mailer, "should be a Mailer instance");
});

test("gmail adapter: send() in simulation mode returns { messageId, threadId } both strings", async () => {
  const { createMailer } = await import("../src/adapters/mail/gmail.js");
  const mailer = await createMailer();
  const result = await mailer.send({
    to: "a@b.com",
    subject: "Hi",
    body: "Hello",
    errandId: "e1"
  });
  assert.equal(typeof result.messageId, "string");
  assert.ok(result.messageId.length > 0, "messageId must be non-empty");
  assert.equal(typeof result.threadId, "string");
});

test("gmail adapter: send() throws AdapterError when to is missing", async () => {
  const { createMailer } = await import("../src/adapters/mail/gmail.js");
  const mailer = await createMailer();
  await assert.rejects(
    mailer.send({ subject: "Hi", body: "Hello", errandId: "e1" }),
    (error) => {
      assert.ok(error instanceof AdapterError, "should throw AdapterError");
      assert.equal(error.kind, "invalid");
      assert.equal(error.provider, "gmail");
      return true;
    }
  );
});

test("gmail adapter: send() throws AdapterError when subject is missing", async () => {
  const { createMailer } = await import("../src/adapters/mail/gmail.js");
  const mailer = await createMailer();
  await assert.rejects(
    mailer.send({ to: "a@b.com", body: "Hello", errandId: "e1" }),
    (error) => {
      assert.ok(error instanceof AdapterError, "should throw AdapterError");
      assert.equal(error.kind, "invalid");
      assert.equal(error.provider, "gmail");
      return true;
    }
  );
});

test("gmail adapter: poll() in simulation mode returns an array", async () => {
  const { createMailer } = await import("../src/adapters/mail/gmail.js");
  const mailer = await createMailer();
  const messages = await mailer.poll("thread-1");
  assert.ok(Array.isArray(messages), "poll should return an array");
});
