// One-time index bootstrap for Moss.
//
// Reads data/moss-corpus/dental-call.json and uploads it to the Moss index
// configured via MOSS_INDEX_NAME (default 'gofer-dental-call'). Idempotent:
// if the index already exists we upsert documents instead of recreating it.
//
// Run with:
//   MOSS_PROJECT_ID=...  MOSS_PROJECT_KEY=...  npm run moss:build-index
//
// Reference: https://docs.moss.dev/docs/reference/js/classes/MossClient
import "../src/lib/env.js";
import { readFile } from "node:fs/promises";
import { config } from "../src/lib/config.js";

if (!config.moss.projectId || !config.moss.projectKey) {
  console.error("MOSS_PROJECT_ID and MOSS_PROJECT_KEY must be set in the environment.");
  process.exit(1);
}

const corpusPath = "data/moss-corpus/dental-call.json";
let corpus;
try {
  corpus = JSON.parse(await readFile(corpusPath, "utf8"));
} catch (error) {
  console.error(`Could not read ${corpusPath}: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(corpus.documents) || corpus.documents.length === 0) {
  console.error(`Corpus at ${corpusPath} is empty.`);
  process.exit(1);
}

const indexName = config.moss.indexName;
const docs = corpus.documents.map((doc) => ({
  id: doc.id,
  text: doc.text,
  metadata: doc.metadata || {}
}));

const { MossClient } = await import("@moss-dev/moss");
const client = new MossClient(config.moss.projectId, config.moss.projectKey);

console.log(`Index: ${indexName}`);
console.log(`Documents: ${docs.length}`);

let existing = null;
try {
  existing = await client.getIndex(indexName);
} catch {
  // getIndex throws when the index does not exist; that is fine.
}

if (existing) {
  console.log(`Index already exists. Upserting documents.`);
  const result = await client.addDocs(indexName, docs, {
    upsert: true,
    onProgress: (p) => process.stdout.write(`\r  ${p.status} ${p.progress ?? ""}%   `)
  });
  process.stdout.write("\n");
  console.log(`Job ${result.jobId || "(unknown)"} completed.`);
} else {
  console.log(`Index does not exist. Creating.`);
  const result = await client.createIndex(indexName, docs, {
    onProgress: (p) => process.stdout.write(`\r  ${p.status} ${p.progress ?? ""}%   `)
  });
  process.stdout.write("\n");
  console.log(`Job ${result.jobId || "(unknown)"} completed.`);
}

console.log(`Done. The index is ready for retrieveMossContext to query.`);
