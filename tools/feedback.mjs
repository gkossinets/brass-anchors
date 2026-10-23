#!/usr/bin/env node
// List messages from the feedback form. Reads `wrangler d1 execute --json` output on stdin:
//   make feedback         (the live database)
//   make feedback LOCAL=1 (the local one used by `make site-dev`)
import { readFileSync } from "node:fs";
import { formatFeedback } from "../server/feedback-core.js";

const input = readFileSync(0, "utf8");
let rows;
try {
  rows = JSON.parse(input)[0].results;
} catch {
  console.error(`feedback: expected wrangler --json output on stdin, got: ${input.slice(0, 200)}`);
  process.exit(1);
}
console.log(formatFeedback(rows));
