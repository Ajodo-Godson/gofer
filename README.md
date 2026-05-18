# GOFER

**Autonomous errand agents that make phone calls, browse authenticated sites, send emails, and handle payments — in parallel — with your approval before anything irreversible happens.**

Built at the Call My Agent Hackathon (YC), May 2026.

**Live demo: https://inspiring-forgiveness-production-eb79.up.railway.app**

---

## What It Does

You type one sentence. GOFER dispatches a team of specialist agents that coordinate across every channel to get it done.

- **Book a dentist appointment** — GOFER calls the office (live phone call via AgentPhone), navigates the conversation naturally, and reports back. No online booking system? Doesn't matter.
- **Order biryani from UberEats** — GOFER opens UberEats with your authenticated browser profile, finds the restaurant, surfaces options, and builds the cart. It stops before checkout and asks you to confirm.
- **Dispute a PG&E charge** — GOFER logs into the billing portal, prepares the dispute draft, and stops for your approval before submitting anything.
- **Order flowers** — GOFER finds options, prepares the order, and stops before payment.

These aren't browser demos with pre-loaded state. Every run is live: real phone calls, real browser sessions, real authenticated portals.

---

## Why GOFER Is Different

Every other AI agent system today is a browser agent. They open a tab, click things, and stop when they hit a login wall, a CAPTCHA, or a phone number.

GOFER is built around the real shape of errands:

| What the errand needs | How GOFER handles it |
|---|---|
| Provider only takes phone calls | AgentPhone — live outbound call |
| Site requires your login | Browser Use profile sync — authenticated session |
| Confirmation sent by email | AgentMail — reads and replies |
| Needs your payment method | Sponge + Stripe — pre-authorized, gated by approval |
| You did this errand before | Supermemory — recalls preferences, providers, past decisions |
| Agent needs domain knowledge | Moss — RAG over your saved context |

And all of it runs in **parallel**. While GOFER is on the phone with the dentist, it is also browsing UberEats and preparing the dispute form. Separate agents, separate queues, separate lifecycles — shown live in the dashboard.

---

## The Supermemory Angle

Every task GOFER completes writes back to Supermemory. Not just "done" — the context. Which dentist, which time preference, which item you approved, which restaurant you've used before.

Next time you say "book the dentist," GOFER already knows the provider, the number, and that you prefer mornings. The system gets faster and more accurate with every errand. No competitor has a memory layer that persists across sessions and actively informs future autonomous decisions.

---

## Safety Model

GOFER is designed to move fast and stop at the right boundaries.

Every workflow template defines explicit **approval gates** — points where GOFER pauses and requires your confirmation before proceeding. These gates cover:

- Payment or deposit submission
- Final order or booking confirmation
- Sensitive form submission
- OAuth / authentication handoff
- Any action that cannot be undone

GOFER returns options, prepares actions, and surfaces context. You approve. It executes.

---

## Sponsor Stack

Every integration is live — not mocked, not simulated.

- **Browser Use** — authenticated cloud browser sessions with profile sync and structured output
- **AgentPhone** — outbound voice calls with live webhook transcripts
- **AgentMail** — email send, receive, and thread management for agents
- **Supermemory** — persistent cross-session memory and preference recall
- **Moss** — retrieval-augmented knowledge context during live tasks
- **Sponge** — agent wallet layer for prepared payment flows
- **Stripe** — payment collection and success-fee infrastructure

---

## Architecture

```
User input
    │
    ▼
Planner → maps request to workflow template
    │
    ▼
Orchestrator → dispatches jobs to specialist agents (parallel)
    │
    ├── BrowserReconAgent    (Browser Use — search, carts, portals)
    ├── PhoneBookingAgent    (AgentPhone — live calls)
    ├── EmailApplicationAgent (AgentMail — send/receive)
    ├── MemoryLegalAgent     (Supermemory + Moss — recall + context)
    └── PaymentAgent         (Sponge + Stripe — payment prep)
    │
    ▼
Dashboard streams live state, artifacts, approval gates
    │
    ▼
User approves → GOFER executes the irreversible step
```

Workflow templates live in `src/lib/workflowTemplates.js`. Each template defines matching rules, required integrations, approval gates, agent routing, and Browser Use prompts with structured output schemas.

---

## Running Locally

```bash
npm install
cp .env.example .env
# Fill in API keys for Browser Use, AgentPhone, AgentMail, Supermemory, Moss, Sponge, Stripe
npm run start
```

Open `http://localhost:8787`.

To sync your browser profile for authenticated sites (UberEats, DoorDash, etc.):

```bash
export BROWSER_USE_API_KEY=your_key && curl -fsSL https://browser-use.com/profile.sh | sh
```

Copy the returned profile ID into `BROWSER_USE_PROFILE_ID` in `.env` and restart.

---

## Team

Built by Godson Ajodo, Jiyun, Carl, and Elijah at the Call My Agent Hackathon (YC), May 2026.
