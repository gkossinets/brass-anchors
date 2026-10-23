#!/usr/bin/env node
// Report on collected play data. Reads `wrangler d1 execute --json` output on stdin:
//   make stats         (the live database)
//   make stats LOCAL=1 (the local one used by `make site-dev`)
import { readFileSync } from "node:fs";
import { summarize, formatReport } from "../server/stats-core.js";

if (process.argv.includes("-h") || process.argv.includes("--help")) {
  console.log("usage: wrangler d1 execute brass-anchors --json --command 'SELECT * FROM events' | node tools/stats.mjs");
  process.exit(0);
}
const input = readFileSync(0, "utf8");
let rows;
try {
  rows = JSON.parse(input)[0].results;
} catch {
  console.error(`stats: expected wrangler --json output on stdin, got: ${input.slice(0, 200)}`);
  process.exit(1);
}
console.log(formatReport(summarize(rows)));
