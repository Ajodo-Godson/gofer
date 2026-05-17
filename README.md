# GOFER

GOFER is an autonomous errand-agent system. A user gives it a real-world task, and GOFER breaks it into specialist work handled by persistent agents: browser research, phone calls, email follow-up, memory retrieval, knowledge lookup, and payment preparation.

The demo is built around practical errands:

- Book a dental appointment with a phone-only provider
- Find restaurant reservation options and stop for user approval before booking
- Prepare purchase or checkout flows without submitting payment
- Dispute a bill through an authenticated portal
- Send confirmations and preserve task memory

GOFER is not a single prompt pretending to multitask. It runs separate agent processes with independent identities, queues, memory scopes, and lifecycles.

## How It Works

1. A task enters GOFER from the dashboard or the demo source-of-truth task list.
2. The planner maps the task to a reusable workflow template.
3. The orchestrator dispatches jobs to persistent specialist agents.
4. Each agent uses the right integration for its part of the workflow.
5. The dashboard streams task state, artifacts, worker status, and approval gates.
6. GOFER stops before irreversible actions such as payment, final booking, account creation, or order submission unless explicitly allowed.

## Agent Workflow

GOFER uses reusable workflow templates in `src/lib/workflowTemplates.js`.

Current workflow families:

- `reservation.find_and_book` - restaurant discovery, candidate ranking, booking approval
- `phone.book_appointment` - phone-based provider scheduling
- `browser.purchase_until_checkout` - product or food cart preparation before checkout
- `browser.fill_form` - portal and application form completion
- `billing.dispute_charge` - billing portal dispute preparation
- `general.errand` - reversible research and coordination tasks

Each workflow defines:

- Matching rules for incoming requests
- Required tools and integrations
- Approval gates
- Agent routing
- Browser Use prompts and structured output schemas where needed

## Persistent Agents

The worker layer lives in `src/agents/`.

- `BrowserReconAgent` handles Browser Use research, portal actions, carts, forms, and website workflows.
- `PhoneBookingAgent` handles AgentPhone calls and appointment workflows.
- `EmailApplicationAgent` handles AgentMail messages and follow-up threads.
- `MemoryLegalAgent` handles Supermemory recall, memory writes, and Moss knowledge context.
- `PaymentAgent` handles payment preparation through Sponge and Stripe.

Each agent has its own queue, status, process identity, memory scope, and completion history. The dashboard exposes these as live worker lanes so it is clear which agent is doing which job.

## Integration System

GOFER treats integrations as workflow infrastructure, not decorative sponsor logos.

- **Browser Use** powers live or headless website operation: search, discovery, form filling, cart building, and authenticated browser workflows. GOFER uses Browser Use Cloud API v3 sessions and structured outputs for reusable workflows.
- **AgentPhone** powers real outbound calls and webhook-driven phone workflows for providers that cannot be reached online.
- **AgentMail** sends and receives formal task follow-up, confirmations, and application-style messages.
- **Supermemory** stores durable task history, user preferences, and cross-task context.
- **Moss** provides fast retrieval for facts needed during live calls or decision points.
- **Sponge** represents the agent wallet layer for prepared payments and fee authorization.
- **Stripe** represents business-side payment collection and success-fee flows.

## Safety Model

GOFER is designed to move fast while stopping at the right boundaries.

Approval gates are built into workflow templates for:

- Final booking confirmation
- Payment or deposit submission
- Order placement
- Sensitive form submission
- Authentication or OAuth handoff
- Any irreversible external commitment

How approval is enforced today:

- Browser Use prompts instruct the agent to stop before payment, final submission, or account creation, and to return `approval_required: true` in its structured output.
- The orchestrator inspects that structured output and, when approval is required, marks the task `pending` and the run `waiting_for_approval` instead of continuing.
- The user can respond through the in-dashboard chat (`POST /api/chat`), which is how a pending task gets resumed or canceled.
- `chargeAgentWallet` in `src/integrations/payments.js` is default-deny: with no Sponge credentials it returns `success: false, status: "not_charged"`, and with credentials it currently returns `mode: "blocked"` until a real adapter is wired. No code path in the live demo charges a wallet today.

Live actions are controlled by environment flags in `.env`. The checked-in `.env.example` documents the required keys and safety toggles.

## Running Locally

```bash
npm install
cp .env.example .env
npm run start
```

Then open:

```text
http://localhost:8787
```

The app serves a Node backend from `src/server.js` and a static dashboard from `public/`.
