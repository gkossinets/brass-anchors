import { test } from "node:test";
import assert from "node:assert/strict";
import { clipDifficulty } from "./clip-stats-core.js";

let nextId = 0;
// One player per game unless a test says otherwise; rows arrive a second apart.
const row = (game, payload, { player = `p_${game}` } = {}) => ({
  id: ++nextId, kind: "round", player, game, mode: payload.mode, round: payload.round,
  received_at: new Date(Date.UTC(2026, 9, 24, 10) + nextId * 1000).toISOString(), payload: JSON.stringify(payload),
});
const languageRound = (game, round, clip, language, guessed, opts) =>
  row(game, { mode: "language", round, clip_id: clip, language, guess: { language: guessed }, score: { language: guessed === language ? 1 : 0 } }, opts);
const classicRound = (game, round, clip, guess, score) => row(game, { mode: "classic", round, clip_id: clip, guess, score });
const matchRound = (game, round, correct, right) =>
  row(game, { format: 3, mode: "match", round, difficulty: "easy", right, points: right ? 1 : 0, correct_id: correct, distractor_id: "other" });

const FULL = { decade: "1970s", country: "US", genre: "news" };

test("language misses: a wrong language guess", () => {
  const d = clipDifficulty([
    languageRound("g1", 1, "fr_a", "fr", "fr"),
    languageRound("g2", 1, "fr_a", "fr", "ru"),
    languageRound("g3", 1, "fr_a", "fr", "ru"),
  ]);
  assert.deepEqual(d.language.hardest[0], { clip: "fr_a", n: 3, missed: 2 });
  assert.equal(d.language.mistakenFor.fr.ru, 2);
});

test("classic misses: a question scored zero; a decade one off is not a miss; the bonus is ignored", () => {
  const d = clipDifficulty([
    classicRound("g1", 1, "us_a", FULL, { decade: 1, country: 1, genre: 1, total: 3 }),
    classicRound("g2", 1, "us_a", FULL, { decade: 2, country: 0, genre: 1, total: 3 }),
    classicRound("g3", 1, "us_a", { ...FULL, station: "NBC" }, { decade: 2, country: 1, genre: 1, station: 0, total: 4 }),
  ]);
  assert.deepEqual(d.classic.hardest[0], { clip: "us_a", n: 3, missed: 1 });
});

test("classic one-country rounds ask no country", () => {
  const oneCountry = { decade: "1970s", genre: "news" };
  const d = clipDifficulty(["g1", "g2", "g3"].map((g) =>
    classicRound(g, 1, "uk_c", oneCountry, { decade: 2, genre: 1, total: 3 })));
  assert.deepEqual(d.classic.hardest[0], { clip: "uk_c", n: 3, missed: 0 });
});

test("match misses count against the right answer", () => {
  const d = clipDifficulty([
    matchRound("g1", 1, "uk_b", false),
    matchRound("g2", 1, "uk_b", false),
    matchRound("g3", 1, "uk_b", true),
  ]);
  assert.deepEqual(d.match.hardest, [{ clip: "uk_b", n: 3, missed: 2 }]);
});

test("replays count: every game by the same player is included", () => {
  const d = clipDifficulty([
    languageRound("g1", 1, "fr_a", "fr", "ru", { player: "p1" }),
    languageRound("g2", 1, "fr_a", "fr", "fr", { player: "p1" }),
    languageRound("g3", 1, "fr_a", "fr", "fr", { player: "p1" }),
  ]);
  assert.deepEqual(d.language.hardest[0], { clip: "fr_a", n: 3, missed: 1 });
});

test("a round sent twice counts once", () => {
  const d = clipDifficulty([
    languageRound("g1", 1, "fr_a", "fr", "ru"),
    languageRound("g1", 1, "fr_a", "fr", "ru"),
    languageRound("g2", 1, "fr_a", "fr", "fr"),
    languageRound("g3", 1, "fr_a", "fr", "fr"),
  ]);
  assert.deepEqual(d.language.hardest[0], { clip: "fr_a", n: 3, missed: 1 });
});

test("clips with fewer than minAttempts plays are left out, and at most `top` are listed", () => {
  const rows = [languageRound("x1", 1, "rare", "fr", "ru"), languageRound("x2", 1, "rare", "fr", "ru")];
  for (let c = 0; c < 12; c++) {
    for (let g = 0; g < 3; g++) rows.push(languageRound(`c${c}g${g}`, 1, `clip_${c}`, "ru", g < c % 3 ? "fr" : "ru"));
  }
  const d = clipDifficulty(rows);
  assert.equal(d.minAttempts, 3);
  assert.equal(d.language.hardest.length, 10);
  assert.ok(!d.language.hardest.some((e) => e.clip === "rare"));
});

test("hardest first: by miss rate, then by plays, then by id", () => {
  const rows = [];
  const add = (clip, results) => results.forEach((right, i) => rows.push(languageRound(`${clip}${i}`, 1, clip, "fr", right ? "fr" : "ru")));
  add("b", [false, true, true]);
  add("a", [false, true, true]);
  add("c", [false, false, true, true, true, true]);
  add("d", [false, false, true]);
  assert.deepEqual(clipDifficulty(rows).language.hardest.map((e) => e.clip), ["d", "c", "a", "b"]);
});

test("clip ids the manifest no longer has are still listed", () => {
  const d = clipDifficulty(["g1", "g2", "g3"].map((g) => languageRound(g, 1, "zh_gone", "zh", "ru")));
  assert.equal(d.language.hardest[0].clip, "zh_gone");
});

test("no rows: empty lists, not errors", () => {
  const d = clipDifficulty([]);
  assert.deepEqual([d.language.hardest, d.match.hardest, d.classic.hardest, d.language.mistakenFor, d.rounds], [[], [], [], {}, 0]);
});

test("a clip id named like an inherited property is tallied like any other, without touching Object.prototype", () => {
  const d = clipDifficulty(["g1", "g2", "g3"].map((g) => languageRound(g, 1, "__proto__", "fr", "ru")));
  assert.deepEqual(d.language.hardest, [{ clip: "__proto__", n: 3, missed: 3 }]);
  assert.equal({}.n, undefined);
  const c = clipDifficulty(["g1", "g2", "g3"].map((g) => classicRound(g, 1, "__proto__", FULL, { decade: 0, country: 1, genre: 1, total: 2 })));
  assert.deepEqual(c.classic.hardest, [{ clip: "__proto__", n: 3, missed: 3 }]);
});
