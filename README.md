# GOFER

GOFER is a local hackathon demo for autonomous errand agents. It coordinates persistent worker agents for browser research, phone booking, email handling, memory, knowledge lookup, and payments through one mission-control dashboard.

## Run Locally

```bash
npm install
cp .env.example .env
npm run start
```

Open `http://localhost:8787`.

## Useful Scripts

```bash
npm run start
npm run dev
npm run build
```

`npm run build` is intentionally a no-op because this app serves static assets directly from `public/` and runs the backend from `src/server.js`.

## Environment

Real integration keys stay in `.env`, which is ignored by git. Start from `.env.example` and enable live actions with the explicit safety toggles:

- `ALLOW_BROWSER_USE_LIVE_TASK=true`
- `ALLOW_REAL_RESTAURANT_CALLS=true`
- `ALLOW_REAL_SMS_SEND=true`
- `ALLOW_REAL_EMAIL_SEND=true`

Do not commit `.env` or `transcripts.md`.

## Core Paths

- `src/server.js` - HTTP server and API routes
- `src/lib/orchestrator.js` - GOFER task execution
- `src/lib/workflowTemplates.js` - reusable errand workflow templates
- `src/agents/` - persistent worker agent manager and workers
- `src/integrations/` - Browser Use, AgentPhone, AgentMail, memory, and payment integrations
- `public/` - dashboard UI
- `data/` - demo source data
