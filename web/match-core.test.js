import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { seededRng } from "./quiz-core.js";
import {
  MATCH_CONFIG, describe, differingAttributes, levelFor, difficultySchedule, candidateDistractors,
  buildMatchGame, scoreMatch, summarizeMatch, pairCoverage, decadeGap, weightedDifferences, matchPoolSize, matchMaxRounds, findPhrase,
} from "./match-core.js";

const clip = (id, country, decade, genre, speaker = id, recognizable = "unlikely", year = null, language = "en") =>
  ({ id, speaker, recognizable, year, answer: { country, language, decade, genre } });

// A small corpus with every kind of pair, including one speaker in two decades.
const CORPUS = [
  clip("us70n", "US", "1970s", "news"),
  clip("us90n", "US", "1990s", "news"),
  clip("us10o", "US", "2010s", "opinion"),
  clip("uk70n", "UK", "1970s", "news"),
  clip("uk90n", "UK", "1990s", "news", "Same Person"),
  clip("uk10n", "UK", "2010s", "news", "Same Person"),
  clip("uk10o", "UK", "2010s", "opinion", "uk10o", "likely"),
  clip("us70o", "US", "1970s", "opinion"),
];

test("description reads country, kind of clip, and decade from config", () => {
  assert.equal(describe(clip("a", "UK", "1970s", "news")).text, "UK news report from the 1970s");
  assert.equal(describe(clip("a", "US", "2010s", "opinion")).text, "US opinion piece from the 2010s");
  const parts = describe(clip("a", "UK", "1970s", "news"));
  assert.deepEqual([parts.country, parts.genre, parts.decade], ["UK", "news report", "1970s"]);
});

test("USSR/Russia is Soviet before 1992 and Russian after", () => {
  assert.equal(describe(clip("a", "USSR/Russia", "1980s", "news", "a", "unlikely", 1985)).country, "Soviet");
  assert.equal(describe(clip("a", "USSR/Russia", "2010s", "news", "a", "unlikely", 2019)).country, "Russian");
});

test("difference counting and difficulty levels", () => {
  assert.deepEqual(differingAttributes(CORPUS[0], CORPUS[1]), ["decade"]);
  assert.deepEqual(differingAttributes(CORPUS[0], CORPUS[6]), ["country", "decade", "genre"]);
  assert.equal(levelFor(3), "easy");
  assert.equal(levelFor(4), "easy");
  assert.equal(levelFor(2), "medium");
  assert.equal(levelFor(1), "hard");
  assert.equal(levelFor(0), null);
});

test("decades three or more apart count as two differences", () => {
  assert.equal(MATCH_CONFIG.decadeFarGap, 3);
  const at = (decade, country = "UK", genre = "news") => clip(decade, country, decade, genre);
  assert.equal(decadeGap(at("1990s"), at("2000s")), 1);
  assert.equal(decadeGap(at("1960s"), at("2020s")), 6);
  assert.equal(levelFor(weightedDifferences(at("1990s"), at("2000s"))), "hard");   // Rather vs Couric
  assert.equal(levelFor(weightedDifferences(at("1970s"), at("1990s"))), "hard");   // two apart: still hard
  assert.equal(levelFor(weightedDifferences(at("1960s"), at("2020s"))), "medium"); // Dougall vs Myrie
  assert.equal(levelFor(weightedDifferences(at("1970s"), at("2000s"))), "medium"); // exactly three apart
  assert.equal(levelFor(weightedDifferences(at("1970s"), at("2010s", "US"))), "easy");
  assert.equal(levelFor(weightedDifferences(at("1970s"), at("1980s", "US"))), "medium");
});

test("schedule runs easy to hard: 10 rounds are 3 easy, 4 medium, 3 hard", () => {
  assert.deepEqual(difficultySchedule(10), ["easy", "easy", "easy", "medium", "medium", "medium", "medium", "hard", "hard", "hard"]);
  assert.deepEqual(difficultySchedule(1), ["easy"]);
  assert.equal(difficultySchedule(20).length, 20);
});

test("candidates differ by exactly the level's count; same speaker only at hard", () => {
  const hard = candidateDistractors(CORPUS[4], CORPUS, "hard").map((c) => c.id);
  assert.ok(hard.includes("uk10n"), "same speaker allowed at hard");
  const medium = candidateDistractors(CORPUS[4], CORPUS, "medium").map((c) => c.id);
  assert.ok(!medium.includes("uk10n") || differingAttributes(CORPUS[4], CORPUS[5]).length === 2);
  for (const level of ["easy", "medium", "hard"]) {
    for (const c of CORPUS) {
      for (const d of candidateDistractors(c, CORPUS, level)) {
        assert.notEqual(d.id, c.id);
        assert.equal(levelFor(weightedDifferences(c, d)), level);
        if (level !== "hard") assert.notEqual(d.speaker, c.speaker);
      }
    }
  }
});

function checkGame(game, corpus, { pure = false } = {}) {
  // Once heard, a clip is recognizable by its opening, so no clip plays twice in a game, in either role.
  const heard = game.rounds.flatMap((r) => [r.correct.id, r.distractor.id]);
  assert.equal(new Set(heard).size, heard.length, "no clip is used twice in a game");
  game.rounds.forEach((r, i) => {
    assert.ok(r.differs.length >= 1, "distractor never matches the description");
    assert.deepEqual(r.differs, differingAttributes(r.correct, r.distractor));
    assert.equal(r.level, levelFor(weightedDifferences(r.correct, r.distractor)));
    assert.equal(r.decadeGap, decadeGap(r.correct, r.distractor));
    if (r.level === "hard" && r.differs[0] === "decade") assert.ok(r.decadeGap < MATCH_CONFIG.decadeFarGap, "far-apart decades are never hard");
    if (r.correct.speaker === r.distractor.speaker) assert.equal(r.level, "hard");
    assert.ok(["A", "B"].includes(r.correctSide));
    if (pure) for (const c of [r.correct, r.distractor]) assert.notEqual(c.recognizable, "likely");
  });
}

test("many generated games obey every pairing rule", () => {
  for (let seed = 0; seed < 300; seed++) {
    const pure = seed % 2 === 0;
    const game = buildMatchGame(CORPUS, { rounds: 6, pure, rng: seededRng(seed) });
    checkGame(game, CORPUS, { pure });
  }
});

test("pairs from the real manifest obey every rule (when web/quiz.json has been built)", (t) => {
  const path = new URL("./quiz.json", import.meta.url);
  if (!existsSync(path)) return t.skip("web/quiz.json not built");
  const corpus = JSON.parse(readFileSync(path)).clips;
  for (let seed = 0; seed < 500; seed++) {
    const pure = seed % 3 === 0;
    const game = buildMatchGame(corpus, { rounds: 10, pure, rng: seededRng(seed) });
    // Two clips a round, none reused: 20 clips allow 10 rounds, pure mode's 19 allow 9.
    assert.equal(game.rounds.length, Math.min(10, matchMaxRounds(corpus, { pure })));
    checkGame(game, corpus, { pure });
    assert.deepEqual(game.fallbacks, [], `seed ${seed}: the corpus supports the full ramp without reuse`);
  }
});

test("the correct clip lands on both sides across games", () => {
  const sides = new Set();
  for (let seed = 0; seed < 20; seed++) for (const r of buildMatchGame(CORPUS, { rounds: 4, rng: seededRng(seed) }).rounds) sides.add(r.correctSide);
  assert.deepEqual([...sides].sort(), ["A", "B"]);
});

test("difficulty follows the schedule when the corpus allows it", () => {
  const game = buildMatchGame(CORPUS, { rounds: 4, rng: seededRng(4) });
  assert.deepEqual(game.rounds.map((r) => r.requestedLevel), difficultySchedule(4));
  for (const r of game.rounds) if (!r.fellBack) assert.equal(r.level, r.requestedLevel);
});

test("missing hard pairs fall back to an easier level, and say so", () => {
  // Every pair here differs on all three attributes, so no medium or hard pairs exist.
  // (Four distinct values per attribute: with only two countries that's impossible.)
  const sparse = [
    clip("a", "US", "1970s", "news"), clip("b", "UK", "2010s", "opinion"),
    clip("c", "FR", "1990s", "g3"), clip("d", "DE", "2020s", "g4"),
  ];
  assert.equal(pairCoverage(sparse).pairs.hard + pairCoverage(sparse).pairs.medium, 0, "fixture really has no harder pairs");
  const game = buildMatchGame(sparse, { rounds: 4, rng: seededRng(1) });
  assert.equal(game.rounds.length, 2, "four clips, two per round");
  for (const r of game.rounds) assert.equal(r.level, "easy");
  const fell = game.rounds.filter((r) => r.requestedLevel !== "easy");
  assert.ok(fell.every((r) => r.fellBack));
  assert.equal(game.fallbacks.length, fell.length);
  assert.match(game.fallbacks[0], /fell back/);
});

test("a game is at most half as many rounds as there are clips, since none is reused", () => {
  assert.equal(matchMaxRounds(CORPUS), 4);
  assert.equal(matchMaxRounds(CORPUS, { pure: true }), 3); // 7 clips without the recognizable one
  assert.equal(buildMatchGame(CORPUS, { rounds: 50, rng: seededRng(2) }).rounds.length, 4);
});

test("pairing searches ahead: a pick that strands the last two clips is avoided", () => {
  // c and d are alike (same country, decade, and genre), so they can't be paired with each other.
  // A first round of a vs b would leave only c and d, ending the game a round early.
  const corpus = [
    clip("a", "US", "1970s", "news"), clip("b", "UK", "2010s", "opinion"),
    clip("c", "US", "1990s", "news", "C"), clip("d", "US", "1990s", "news", "D"),
  ];
  for (let seed = 0; seed < 50; seed++) {
    const game = buildMatchGame(corpus, { rounds: 2, rng: seededRng(seed) });
    assert.equal(game.rounds.length, 2, `seed ${seed}`);
    checkGame(game, corpus);
  }
});

test("scoring multiplies by difficulty from config", () => {
  assert.deepEqual(MATCH_CONFIG.points, { easy: 1, medium: 2, hard: 3 });
  assert.deepEqual(scoreMatch({ level: "hard", correctSide: "B" }, "B"), { right: true, points: 3 });
  assert.deepEqual(scoreMatch({ level: "hard", correctSide: "B" }, "A"), { right: false, points: 0 });
});

test("summary breaks accuracy down by difficulty and by what differed in hard rounds", () => {
  const results = [
    { level: "easy", differs: ["country", "decade", "genre"], right: true, points: 1 },
    { level: "medium", differs: ["decade", "genre"], right: false, points: 0 },
    { level: "hard", differs: ["decade"], right: true, points: 3 },
    { level: "hard", differs: ["decade"], right: false, points: 0 },
    { level: "hard", differs: ["genre"], right: true, points: 3 },
  ];
  const s = summarizeMatch(results);
  assert.equal(s.total, 7);
  assert.equal(s.max, 1 + 2 + 3 + 3 + 3);
  assert.deepEqual(s.byLevel.hard, { right: 2, total: 3 });
  assert.deepEqual(s.byLevel.medium, { right: 0, total: 1 });
  assert.deepEqual(s.hardByAttribute, { decade: { right: 1, total: 2 }, genre: { right: 1, total: 1 } });
});

test("pair coverage counts pairs per level, clips without partners, and what hard pairs differ by", () => {
  const cov = pairCoverage(CORPUS);
  for (const level of ["easy", "medium", "hard"]) {
    const expected = CORPUS.reduce((n, c) => n + candidateDistractors(c, CORPUS, level).length, 0);
    assert.equal(cov.pairs[level], expected);
  }
  assert.equal(Object.values(cov.hardByAttribute).reduce((a, b) => a + b, 0), cov.pairs.hard);
  assert.equal(Object.values(cov.hardDecadeGaps).reduce((a, b) => a + b, 0), cov.hardByAttribute.decade ?? 0);
  for (const gap of Object.keys(cov.hardDecadeGaps)) assert.ok(Number(gap) < MATCH_CONFIG.decadeFarGap);
  assert.ok(Array.isArray(cov.unusable.easy));
  const pure = pairCoverage(CORPUS, { pure: true });
  assert.ok(pure.pairs.easy <= cov.pairs.easy);
});

test("stats for geeks: labelled rows with units, plain-language hints, and dashes for missing values", async () => {
  const { geekStatsRows } = await import("./match-core.js");
  const rows = geekStatsRows({ median_hz: 141, range_st: 10.8, sd_st: 3.5, syllables_per_s: 4.6,
    pauses: 3, pauses_per_min: 12, mean_pause_s: 0.43, pause_pct: 13, duration_s: 15 });
  assert.deepEqual(rows.map((r) => r.label), ["Average pitch", "Pitch range", "Pitch variation", "Speaking rate (rough)", "Pauses per minute", "Average pause"]);
  assert.match(rows[3].hint, /rough estimate/);
  assert.deepEqual(rows.map((r) => r.value), ["141 Hz", "10.8 semitones", "3.5 semitones", "4.6 syllables/s", "12", "0.43 s"]);
  assert.ok(rows.every((r) => r.hint.length > 0));
  assert.match(rows[4].hint, /13% of the clip/);
  // Short values, so labels and values each fit on one line in a half-width card.
  assert.ok(rows.every((r) => r.value.length <= 16), JSON.stringify(rows.map((r) => r.value)));

  const sparse = geekStatsRows({ median_hz: null, range_st: null, sd_st: null, syllables_per_s: null,
    pauses: 0, pauses_per_min: 0, mean_pause_s: null, pause_pct: 0, duration_s: 2 });
  assert.deepEqual(sparse.map((r) => r.value), ["—", "—", "—", "—", "0", "—"]);
  assert.deepEqual(geekStatsRows(null), []);
});

test("stats keep their decimals even for whole numbers (JSON turns 5.0 into 5)", async () => {
  const { geekStatsRows } = await import("./match-core.js");
  const rows = geekStatsRows({ median_hz: 190, range_st: 12, sd_st: 4, syllables_per_s: 5,
    pauses: 2, pauses_per_min: 8, mean_pause_s: 0.5, pause_pct: 6, duration_s: 15 });
  assert.deepEqual(rows.map((r) => r.value), ["190 Hz", "12.0 semitones", "4.0 semitones", "5.0 syllables/s", "8", "0.50 s"]);
});

test("match pool size counts the clips a game can use; pure mode drops likely-recognizable ones", () => {
  assert.equal(matchPoolSize(CORPUS, { pure: false }), 8);
  assert.equal(matchPoolSize(CORPUS, { pure: true }), 7);
});

test("findPhrase completes the FIND caption: an article, then the description", () => {
  assert.equal(findPhrase(clip("a", "UK", "1970s", "news")), "a UK news report from the 1970s");
  assert.equal(findPhrase(clip("a", "US", "2010s", "opinion")), "a US opinion piece from the 2010s");
});

test("Match plays English clips only: the language would give the description away", () => {
  const foreign = [
    clip("fr70n", "France", "1970s", "news", "fr70n", "unlikely", 1975, "fr"),
    clip("ru80n", "USSR/Russia", "1980s", "news", "ru80n", "unlikely", 1985, "ru"),
  ];
  const corpus = [...CORPUS, ...foreign];
  assert.equal(matchPoolSize(corpus), CORPUS.length);
  assert.equal(matchMaxRounds(corpus), matchMaxRounds(CORPUS));
  for (let seed = 1; seed <= 20; seed++) {
    const { rounds } = buildMatchGame(corpus, { rounds: 4, rng: seededRng(seed) });
    assert.equal(rounds.length, 4);
    for (const r of rounds) {
      assert.ok(![r.correct.id, r.distractor.id].some((id) => id === "fr70n" || id === "ru80n"));
    }
  }
});
