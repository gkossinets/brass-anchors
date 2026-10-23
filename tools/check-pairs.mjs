#!/usr/bin/env node
// Corpus coverage for "Match the description": run with `make check-pairs`.
// Uses the game's own rules (web/match-core.js), so the report and the game agree.
import { readFileSync } from "node:fs";
import { pairCoverage, LEVELS, MATCH_CONFIG } from "../web/match-core.js";

const SHORT = { country: "country", decade: "decade", genre: "news/opinion" };

const manifest = new URL("../web/quiz.json", import.meta.url);
let clips;
try {
  clips = JSON.parse(readFileSync(manifest)).clips;
} catch (err) {
  console.error(`Can't read web/quiz.json (${err.message}). Run \`make audio\` first.`);
  process.exit(1);
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

for (const pure of [false, true]) {
  const cov = pairCoverage(clips, { pure });
  console.log(`\n${pure ? "Pure mode (recognizable=likely excluded)" : "All clips"}: ${cov.clips} clips`);
  console.log(`${pad("level", 8)}${lpad("pairs", 7)}  clips with no partner at this level`);
  for (const level of LEVELS) {
    const none = cov.unusable[level];
    console.log(`${pad(level, 8)}${lpad(cov.pairs[level], 7)}  ${none.length ? none.join(", ") : "none"}`);
  }
  const hard = Object.entries(cov.hardByAttribute).sort((a, b) => b[1] - a[1]);
  const total = hard.reduce((n, [, c]) => n + c, 0);
  console.log(`hard pairs differ only by: ${hard.map(([k, c]) => `${SHORT[k]} ${c} (${Math.round(100 * c / total)}%)`).join(", ")}`);
  const gaps = Object.entries(cov.hardDecadeGaps).map(([g, c]) => `${g} decade${g === "1" ? "" : "s"} apart ${c}`).join(", ");
  if (gaps) console.log(`  decade-only hard pairs: ${gaps}`);
}
console.log(`\nPairs are ordered (correct clip, distractor). Differences: country 1, news/opinion 1, decade 1 (or 2 when ${MATCH_CONFIG.decadeFarGap}+ decades apart). Easy = 3+, medium = 2, hard = 1.`);
