import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, formatReport, median } from "./stats-core.js";

let nextId = 0;
const row = (kind, game, payload, { player = "p1", mode = payload.mode, at = `2026-10-23T10:00:${String(nextId).padStart(2, "0")}Z` } = {}) =>
  ({ id: ++nextId, kind, player, game, mode, round: payload.round ?? null, received_at: at, payload: JSON.stringify(payload) });

const matchRound = (game, round, level, right, ms, { correct = "a", distractor = "b", differs = ["decade"] } = {}) =>
  row("round", game, { mode: "match", round, difficulty: level, right, ms_first_play_to_answer: ms, correct_id: correct, distractor_id: distractor, differs });

const classicRound = (game, round, clip, guess, score, ms) =>
  row("round", game, { mode: "classic", round, clip_id: clip, guess, score, ms_first_play_to_answer: ms });

test("median ignores missing times and averages the middle pair", () => {
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([null]), null);
});

test("counts players, games started, and games saved", () => {
  const s = summarize([
    matchRound("g1", 1, "easy", true, 1000),
    matchRound("g2", 1, "easy", true, 1000, { }),
    row("game", "g1", { mode: "match", cues: "" }),
    { ...matchRound("g3", 1, "easy", true, 1000), player: "p2" },
  ]);
  assert.deepEqual([s.players, s.games, s.saved], [2, 3, 1]);
});

test("match accuracy and median time by difficulty, and by attribute for hard rounds", () => {
  const s = summarize([
    matchRound("g1", 1, "easy", true, 4000),
    matchRound("g1", 2, "easy", false, 6000),
    matchRound("g1", 3, "hard", false, 20000, { differs: ["genre"] }),
    matchRound("g1", 4, "hard", true, 10000, { differs: ["decade"] }),
  ]);
  assert.deepEqual(s.match.byLevel.easy, { n: 2, right: 1, medianMs: 5000 });
  assert.deepEqual(s.match.byLevel.hard, { n: 2, right: 1, medianMs: 15000 });
  assert.equal(s.match.byLevel.medium, undefined);
  assert.deepEqual(s.match.hardByAttribute, { genre: { n: 1, right: 0, medianMs: 20000 }, decade: { n: 1, right: 1, medianMs: 10000 } });
});

test("a pair counts the same whichever clip was the right answer; hardest first", () => {
  const s = summarize([
    matchRound("g1", 1, "hard", false, 9000, { correct: "x", distractor: "y" }),
    matchRound("g2", 1, "hard", true, 7000, { correct: "y", distractor: "x" }),
    matchRound("g3", 1, "easy", true, 2000, { correct: "a", distractor: "b" }),
  ]);
  assert.deepEqual(s.match.pairs.map((p) => [p.clips, p.n, p.right]), [[["x", "y"], 2, 1], [["a", "b"], 1, 1]]);
});

test("a round sent twice for the same game counts once", () => {
  const r = matchRound("g1", 1, "easy", true, 1000);
  assert.equal(summarize([r, { ...r, id: 999 }]).match.byLevel.easy.n, 1);
});

test("classic: share of exact answers per question and points per clip", () => {
  const s = summarize([
    classicRound("g1", 1, "c1", { decade: "1970s", country: "US" }, { decade: 2, country: 0, genre: 0, station: 0, total: 2 }, 5000),
    classicRound("g2", 1, "c1", { decade: "1980s", country: "US" }, { decade: 1, country: 1, genre: 0, station: 0, total: 2 }, 7000),
  ]);
  assert.deepEqual(s.classic.byQuestion.decade, { n: 2, exact: 1 });
  assert.deepEqual(s.classic.byQuestion.country, { n: 2, exact: 1 });
  assert.equal(s.classic.byQuestion.genre, undefined);
  assert.deepEqual(s.classic.byClip, [{ clip: "c1", n: 2, meanPoints: 2, medianMs: 6000 }]);
});

test("notes come from each game's latest save, skipping empty ones", () => {
  const s = summarize([
    row("game", "g1", { mode: "match", cues: "first draft" }, { at: "2026-10-23T10:00:00Z" }),
    row("game", "g1", { mode: "match", cues: "final words" }, { at: "2026-10-23T10:05:00Z" }),
    row("game", "g2", { mode: "classic", cues: "" }),
  ]);
  assert.deepEqual(s.notes, [{ at: "2026-10-23T10:05:00Z", mode: "match", text: "final words" }]);
});

test("rows with unreadable payloads are counted, not fatal", () => {
  const bad = { ...matchRound("g1", 1, "easy", true, 1000), payload: "{oops" };
  const s = summarize([bad, matchRound("g2", 1, "easy", true, 1000)]);
  assert.equal(s.skipped, 1);
  assert.equal(s.match.byLevel.easy.n, 1);
});

test("the report is plain text with the headline numbers", () => {
  const text = formatReport(summarize([
    matchRound("g1", 1, "easy", true, 4000),
    row("game", "g1", { mode: "match", cues: "loved it" }),
  ]));
  assert.match(text, /1 player, 1 game, 1 saved/);
  assert.match(text, /easy\s+1\/1\s+100%\s+4\.0 s/);
  assert.match(text, /loved it/);
});

test("rounds without both clip ids are left out of the pair list", () => {
  const s = summarize([row("round", "g1", { mode: "match", round: 1, difficulty: "easy", right: true }),
    matchRound("g2", 1, "easy", true, 1000)]);
  assert.deepEqual(s.match.pairs.map((p) => p.clips), [["a", "b"]]);
  assert.equal(s.match.byLevel.easy.n, 2);
});
