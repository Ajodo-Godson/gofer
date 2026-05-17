# GOFER Sponsor Capability Roadmap

This file tracks how to make GOFER use sponsor tools as real infrastructure instead of showing labels or hallucinated outcomes. Each item should produce an artifact in the dashboard and a verifiable API response, webhook event, transcript, receipt, memory write, or structured Browser Use result.

## Ground Rules

- Do not mark a sponsor path as live unless the integration returns a real provider response.
- Do not invent confirmations. If a booking, payment, email, or call outcome is pending, show it as pending.
- Never charge, authorize, hold, submit, or prepare payment/card/wallet/deposit flows without explicit user confirmation for that exact task.
- Every workflow should record which agent performed the work, which integration was used, and what proof was returned.
- Every irreversible action needs an approval gate before final submission.
- Prefer reusable workflow templates over one-off prompts.

## Browser Use

Current state: GOFER uses Browser Use Cloud API v3 for browser tasks, structured output on restaurant discovery, live session URLs for optional demos, and a persistent profile requirement for DoorDash-style auth flows.

To do:

- [ ] Add `outputSchema` to every Browser Use workflow, not only restaurant discovery.
- [ ] Create a `browser_sessions` artifact model with `sessionId`, `liveUrl`, `status`, `stepCount`, `totalCostUsd`, `model`, and final `output`.
- [ ] Add per-workflow Browser Use budgets: max runtime, max steps, max cost, and whether live preview should be shown.
- [ ] Add a real authenticated-profile smoke test that verifies `BROWSER_USE_PROFILE_ID` before running DoorDash or other login-heavy sites.
- [ ] Add a fast search-only workflow for discovery tasks where the browser is not visually important.
- [ ] Add a visual/live workflow only when the demo benefits from watching the browser.
- [ ] Store Browser Use failures as structured blockers: auth required, CAPTCHA, rate limit, timeout, cost limit, unsupported site, form missing field.
- [ ] Add retry policy that retries only recoverable failures and never loops on auth/CAPTCHA.
- [ ] Build a controlled demo site for form-fill proof so Browser Use can reliably fill and submit a reversible form on stage.

Verification:

- Browser Use artifact includes real `sessionId`.
- Successful workflows return schema-valid JSON.
- Failed workflows explain the exact blocker and next action.
- DoorDash/cart workflows stop before payment or order submission.

## AgentPhone

Current state: GOFER can place calls and has a phone-booking agent. The Dr. Carl flow needs stronger conversation control and verified outcomes.

To do:

- [ ] Split call prompts into provider-facing speech, private system policy, and user-facing summary so the agent never speaks internal instructions aloud.
- [ ] Add call state machine: greet, state purpose, collect availability, confirm selected time, stop talking, summarize.
- [ ] Add repetition guard that detects when the provider already agreed to a time.
- [ ] Add provider outcome parser for transcripts: booked, callback required, unavailable, voicemail, wrong number, human takeover.
- [ ] Save transcript snippets as artifacts with timestamps and redaction for sensitive details.
- [ ] Implement inbound webhook handling for call/SMS follow-up events.
- [ ] Add test harness with the owned AgentPhone number acting as a deterministic provider.
- [ ] Add human approval before calling non-demo real businesses.

Verification:

- Each call artifact includes `callId`, target number, status, and transcript or webhook payload.
- Appointment status is only `booked` when the transcript contains explicit confirmation.
- Internal instructions never appear in provider-facing speech.

## AgentMail

Current state: GOFER can send email through the email agent, but email workflows are not yet first-class.

To do:

- [ ] Add threaded email artifacts: `messageId`, `threadId`, to/from, subject, status, and provider response.
- [ ] Implement inbound AgentMail webhook route for replies.
- [ ] Add workflow steps for drafting, approval, sending, reply ingestion, and follow-up.
- [ ] Attach structured task context to outgoing emails without leaking private system prompts.
- [ ] Add confirmation email parsing for bookings, applications, and receipts.
- [ ] Add failed-delivery handling and retry with user-visible status.

Verification:

- Sent email artifact includes real provider ID.
- Inbound reply creates a dashboard event and updates the related task.
- Confirmation parsing is based on actual email content.

## Supermemory

Current state: GOFER uses Supermemory for lookup and save-memory jobs.

To do:

- [ ] Define memory namespaces by agent and workflow: user preferences, providers, restaurants, billing, payments, browser sessions.
- [ ] Save structured memories, not only sentence summaries.
- [ ] Store evidence references with each memory: source artifact ID, provider response ID, transcript line, email ID, or Browser Use session ID.
- [ ] Add contradiction detection for provider commitments, appointment times, prices, and policy changes.
- [ ] Add memory recall before each workflow and show which memories affected decisions.
- [ ] Add memory expiration rules for stale availability, prices, and time-sensitive facts.

Verification:

- Memory artifacts show retrieved memories and why they were relevant.
- New memories include source evidence.
- Time-sensitive facts are not reused as current truth without revalidation.

## Moss

Current state: GOFER has a Moss context hook but needs stronger task-specific knowledge use.

To do:

- [ ] Build a small local knowledge corpus for demo domains: dental appointment scripts, billing dispute rules, reservation policies, refund language, payment safety.
- [ ] Add Moss retrieval before phone calls where latency matters.
- [ ] Add Moss citations to call/email drafts only when retrieved, not guessed.
- [ ] Add a dashboard artifact for query, latency, matched fact, and how it was used.
- [ ] Add fallback behavior when Moss returns no useful facts.

Verification:

- Moss artifact includes query, latency, and cited fact.
- Provider-facing speech only cites facts present in the retrieved result.
- No fake legal or policy citation appears when retrieval is empty.

## Sponge

Current state: GOFER has a payment-agent placeholder for wallet charges.

To do:

- [ ] Replace placeholder wallet charge behavior with real Sponge SDK/API calls.
- [ ] Add balance check before any payment-prep step.
- [ ] Add payment authorization artifacts: amount, merchant, purpose, wallet/card ID, status, and receipt/transaction hash if available.
- [ ] Add approval gate before spending money unless under explicit policy.
- [ ] Add failed-payment handling and do not continue checkout if payment prep fails.

Verification:

- Payment artifact comes from a real Sponge response.
- Balance changes or authorization IDs are visible.
- GOFER never reports a payment as complete from simulated data in live mode.

## Stripe

Current state: Stripe is represented in config and payment narrative but not deeply wired.

To do:

- [ ] Add Stripe Payment Intent creation for GOFER service fees.
- [ ] Add checkout/session link generation for user approval flows.
- [ ] Add Stripe webhook handling for payment succeeded, failed, canceled, refunded.
- [ ] Add dashboard artifacts for Payment Intent ID, status, amount, and mode.
- [ ] Keep Stripe separate from Sponge: Stripe charges the user, Sponge pays third parties.

Verification:

- Stripe artifact includes real test-mode Payment Intent or Checkout Session ID.
- Webhook event updates the task state.
- User fee is never charged before the workflow reaches the approved success condition.

## Cross-Agent Orchestration

Current state: GOFER has persistent processes and queues, but workflows can use them more deliberately.

To do:

- [ ] Add workflow DAG definitions so tasks can run in parallel where safe and wait where needed.
- [ ] Add job dependencies: browser discovery before phone calls, approval before booking, payment prep before checkout.
- [ ] Add per-agent memory scope read/write rules.
- [ ] Add durable job history persisted to disk or database, not only in-memory runtime state.
- [ ] Add cancellation and pause/resume for long-running workflows.
- [ ] Add user approval endpoint that resumes the workflow after approval.
- [ ] Add error taxonomy shared across all agents.

Verification:

- Dashboard shows which jobs ran in parallel and which were blocked on dependencies.
- Restarting the server does not lose completed proof artifacts.
- Approval gates can resume a pending task without rerunning completed work.

## Demo-Ready Workflows

High-priority workflows to make sponsor usage obvious:

- [ ] Phone-only dental booking: AgentPhone + Supermemory + Moss, with transcript-verified booking.
- [ ] Restaurant reservation discovery: Browser Use + Supermemory + AgentPhone fallback, approval before final booking.
- [ ] Patient portal form fill: Browser Use controlled site + AgentMail confirmation.
- [ ] Billing dispute: Browser Use portal + AgentMail written dispute + Supermemory evidence trail.
- [ ] Purchase until checkout: Browser Use cart + Sponge payment prep + Stripe user approval, no order submission.

Done means:

- The dashboard shows live agent lanes.
- Every sponsor used in the workflow has a real proof artifact.
- No task claims success without evidence.
- The user sees clear approval gates and next actions.
