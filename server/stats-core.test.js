import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, formatReport, median, publicSummary } from "./stats-core.js";

let nextId = 0;
const row = (kind, game, payload, { player = "p1", mode = payload.mode, at = `2026-10-23T10:00:${String(nextId).padStart(2, "0")}Z` } = {}) =>
  ({ id: ++nextId, kind, player, game, mode, round: payload.round ?? null, received_at: at, payload: JSON.stringify(payload) });

const LEVEL_POINTS = { easy: 1, medium: 2, hard: 3 };
const matchRound = (game, round, level, right, ms, { correct = "a", distractor = "b", differs = ["decade"] } = {}) =>
  row("round", game, { mode: "match", round, difficulty: level, right, points: right ? LEVEL_POINTS[level] : 0,
    ms_first_play_to_answer: ms, correct_id: correct, distractor_id: distractor, differs });

const classicRound = (game, round, clip, guess, score, ms) =>
  row("round", game, { mode: "classic", round, clip_id: clip, guess, score, ms_first_play_to_answer: ms });

test("median ignores missing times and averages the middle pair", () => {
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([null]), null);
});

test("counts games started, games finished, and rounds answered per mode; not players", () => {
  // Player ids are fresh per game (nothing links one person's games), so a player count would mislead.
  const s = summarize([
    matchRound("g1", 1, "easy", true, 1000),
    matchRound("g1", 2, "easy", true, 1000),
    matchRound("g2", 1, "easy", true, 1000, { }),
    row("game", "g1", { mode: "match", cues: "" }),
    classicRound("g3", 1, "c1", {}, { total: 1 }, 4000),
  ]);
  assert.deepEqual([s.games, s.finished], [3, 1]);
  assert.deepEqual(s.rounds, { match: 3, classic: 1 });
  assert.equal(s.players, undefined);
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
  assert.deepEqual(s.classic.byClip, [{ clip: "c1", n: 2, meanPoints: 2, exactShare: 0.5, medianMs: 6000 }]);
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
  assert.match(text, /1 game, 1 finished/);
  assert.doesNotMatch(text, /player/);
  assert.match(text, /easy\s+1\/1\s+100%\s+4\.0 s/);
  assert.match(text, /loved it/);
});

test("rounds without both clip ids are left out of the pair list", () => {
  const s = summarize([row("round", "g1", { mode: "match", round: 1, difficulty: "easy", right: true }),
    matchRound("g2", 1, "easy", true, 1000)]);
  assert.deepEqual(s.match.pairs.map((p) => p.clips), [["a", "b"]]);
  assert.equal(s.match.byLevel.easy.n, 2);
});

const finished = (game, mode, total, max, extra = {}) => row("game", game, { mode, summary: { total, max }, cues: "", ...extra });

test("final scores are percentages of each finished game's maximum, latest record per game", () => {
  const s = summarize([
    matchRound("g1", 1, "easy", true, 3000), matchRound("g1", 2, "easy", false, 3000), finished("g1", "match", 1, 2),
    matchRound("g2", 1, "hard", true, 3000), finished("g2", "match", 3, 3),
    classicRound("g3", 1, "c", {}, { total: 4 }, 3000), classicRound("g3", 2, "c", {}, { total: 5 }, 3000), finished("g3", "classic", 9, 50),
    { ...finished("g1", "match", 1, 2, { cues: "notes on save" }), received_at: "2026-10-23T11:00:00Z" },
    row("game", "g4", { mode: "match", cues: "" }), // no summary: older client, left out
  ]);
  assert.deepEqual(s.scores, { match: [50, 100], classic: [18] });
});

test("the public summary has no notes and no player ids", () => {
  const p = publicSummary([
    matchRound("g1", 1, "easy", true, 1000),
    finished("g1", "match", 1, 1, { cues: "private thoughts" }),
  ]);
  const text = JSON.stringify(p);
  assert.ok(!text.includes("private thoughts"));
  assert.ok(!text.includes("p1"));
  assert.deepEqual([p.games, p.finished], [1, 1]);
  assert.deepEqual(p.rounds, { match: 1, classic: 0 });
  assert.equal(p.players, undefined);
  assert.deepEqual(p.scores.match, [100]);
});

test("easiest and hardest comparisons need enough attempts and never overlap", () => {
  const rounds = [];
  let g = 0;
  const attempts = (correct, distractor, results) => {
    for (const right of results) rounds.push(matchRound(`g${++g}`, 1, "hard", right, 5000, { correct, distractor }));
  };
  attempts("a", "b", [true, true, true]);           // 100%
  attempts("c", "d", [false, false, true]);         // 33%
  attempts("e", "f", [true, false, true]);          // 67%
  attempts("x", "y", [false]);                      // too few attempts to rank
  const p = publicSummary(rounds, { minAttempts: 3, top: 5 });
  assert.deepEqual(p.match.hardest.map((x) => x.clips), [["c", "d"], ["e", "f"]]);
  assert.deepEqual(p.match.easiest.map((x) => x.clips), [["a", "b"]]);
  assert.equal(p.minAttempts, 3);
});

test("classic clips are ranked the same way: hardest and easiest, enough attempts only", () => {
  const rounds = [];
  for (let i = 0; i < 3; i++) {
    rounds.push(classicRound(`h${i}`, 1, "hard_clip", { decade: "1970s" }, { decade: 0, total: 0 }, 9000));
    rounds.push(classicRound(`e${i}`, 1, "easy_clip", { decade: "1970s" }, { decade: 2, total: 4 }, 3000));
  }
  rounds.push(classicRound("z", 1, "rare_clip", { decade: "1970s" }, { decade: 2, total: 5 }, 1000));
  const p = publicSummary(rounds, { minAttempts: 3 });
  assert.deepEqual(p.classic.hardest.map((c) => c.clip), ["hard_clip"]);
  assert.deepEqual(p.classic.easiest.map((c) => c.clip), ["easy_clip"]);
});

test("a game's score counts only when every round arrived and they add up to its total", () => {
  const rounds = (game, pts) => pts.map((p, i) => row("round", game, { mode: "match", round: i + 1, difficulty: "easy",
    right: p > 0, points: p, ms_first_play_to_answer: 3000, correct_id: "a", distractor_id: "b" }));
  const s = summarize([
    ...rounds("real", [1, 0, 1]), finished("real", "match", 2, 3),
    finished("forged", "match", 10, 10),                                   // no rounds at all
    ...rounds("inflated", [1, 0, 0]), finished("inflated", "match", 3, 3), // claims more than its rounds
    ...rounds("gappy", [1, 1]).filter((r) => r.round !== 1), finished("gappy", "match", 1, 2), // round 1 missing
  ]);
  assert.deepEqual(s.scores.match, [67]);
  assert.equal(s.unbacked, 3);
});
