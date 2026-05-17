// Smoke test for retrieveMossContext.
//
// Without Moss credentials, the function should fall back to the local
// corpus and return facts > 0 with a real latencyMs. This test asserts
// the contract that orchestrator.js + worker.js read from:
//   { facts: string[], latencyMs: number }
//
// Run with:
//   node scripts/test-moss-context.mjs

import "../src/lib/env.js";
import { retrieveMossContext } from "../src/integrations/memory.js";

const demoUser = {
  name: "Ajoson",
  insurance: { dentalProvider: "Delta Dental PPO", memberId: "884720-DEMO" },
  preferences: { appointmentTimes: ["morning", "early afternoon"] }
};

const result = await retrieveMossContext({
  query: "Book dentist cleaning this week",
  user: demoUser
});

console.log("mode:", result.mode);
console.log("provider:", result.provider);
console.log("latencyMs:", result.latencyMs);
console.log("facts.length:", result.facts?.length);
console.log("first fact:", result.facts?.[0]?.slice(0, 100));
console.log("warning:", result.warning || "(none)");

const ok =
  ["real", "fallback", "simulated"].includes(result.mode) &&
  Array.isArray(result.facts) &&
  result.facts.length > 0 &&
  typeof result.latencyMs === "number";

console.log("contract OK:", ok);
process.exit(ok ? 0 : 1);
