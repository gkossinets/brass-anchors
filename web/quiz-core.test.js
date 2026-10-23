import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DECADES, GENRES, seededRng, shuffle, decadeOptions, countryOptions, stationOptions,
  scoreRound, filterClips, questionsFor, pickRounds, maxScorePerRound, initialTimbre, displayAnswer, pointsNote, guessMark } from "./quiz-core.js";

const clip = (id, country, decade, genre, station, recognizable = "unlikely") =>
  ({ id, answer: { country, decade, genre, station }, recognizable });

const CLIPS = [
  clip("a", "US", "1970s", "news", "CBS"),
  clip("b", "US", "2010s", "opinion", "Fox News", "likely"),
  clip("c", "UK", "1980s", "news", "BBC"),
  clip("d", "USSR", "1980s", "news", "Central Television"),
  clip("e", "USSR", "1990s", "opinion", "Leningrad TV"),
];

test("shuffle is a permutation and is deterministic for a seed", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = shuffle(xs, seededRng(1));
  assert.deepEqual([...a].sort(), [...xs].sort());
  assert.deepEqual(a, shuffle(xs, seededRng(1)));
  assert.deepEqual(xs, [1, 2, 3, 4, 5, 6, 7, 8], "input not mutated");
});

test("decade options: four distinct, include correct, all neighbours, chronological", () => {
  for (let seed = 0; seed < 50; seed++) {
    for (const correct of DECADES) {
      const opts = decadeOptions(correct, seededRng(seed));
      assert.equal(opts.length, 4);
      assert.equal(new Set(opts).size, 4);
      assert.ok(opts.includes(correct));
      const ci = DECADES.indexOf(correct);
      for (const o of opts) assert.ok(Math.abs(DECADES.indexOf(o) - ci) <= 3, `${o} too far from ${correct}`);
      assert.deepEqual(opts, [...opts].sort());
    }
  }
});

test("country options: only countries in the corpus, in a fixed order", () => {
  // Two-country corpus: two buttons, never invented distractors.
  const corpus = ["US", "UK", "US", "UK", "US"];
  assert.deepEqual(countryOptions("UK", corpus, seededRng(1)), ["US", "UK"]);
  assert.deepEqual(countryOptions("US", corpus, seededRng(2)), ["US", "UK"]);
});

test("country options: a big corpus is capped at four, always including the answer, in corpus order", () => {
  const corpus = ["US", "UK", "USSR/Russia", "Australia", "Finland", "China"];
  for (let seed = 0; seed < 20; seed++) {
    const opts = countryOptions("China", corpus, seededRng(seed));
    assert.equal(opts.length, 4);
    assert.ok(opts.includes("China"));
    assert.deepEqual(opts, [...opts].sort((a, b) => corpus.indexOf(a) - corpus.indexOf(b)));
  }
});

test("station options: correct plus up to three others, no duplicates", () => {
  const opts = stationOptions("CBS", ["CBS", "BBC", "Fox News", "CBS", "ITN", "Russia-1"], seededRng(2));
  assert.equal(opts.length, 4);
  assert.equal(new Set(opts).size, 4);
  assert.ok(opts.includes("CBS"));
  assert.deepEqual(stationOptions("CBS", ["CBS"], seededRng(2)), ["CBS"]);
});

test("scoring: 2 exact decade, 1 adjacent, 1 country, 1 genre, 1 station", () => {
  const answer = { decade: "1970s", country: "US", genre: "news", station: "CBS" };
  assert.deepEqual(
    scoreRound(answer, { decade: "1970s", country: "US", genre: "news", station: "CBS" }),
    { decade: 2, country: 1, genre: 1, station: 1, total: 5 },
  );
  assert.deepEqual(
    scoreRound(answer, { decade: "1980s", country: "UK", genre: "opinion", station: "BBC" }),
    { decade: 1, country: 0, genre: 0, station: 0, total: 1 },
  );
  assert.equal(scoreRound(answer, { decade: "1990s" }).decade, 0);
  assert.equal(scoreRound(answer, {}).total, 0, "unasked questions score zero");
});

test("genre is what the clip does: reporting news or arguing a view", () => {
  assert.deepEqual(GENRES, ["news", "opinion"]);
});

test("answers display capitalized for genre and unchanged otherwise", () => {
  assert.equal(displayAnswer("genre", "news"), "News");
  assert.equal(displayAnswer("genre", "opinion"), "Opinion");
  assert.equal(displayAnswer("country", "US"), "US");
  assert.equal(displayAnswer("station", "Fox News"), "Fox News");
  assert.equal(displayAnswer("genre", undefined), undefined);
});

test("pure mode drops likely-recognizable clips", () => {
  const ids = filterClips(CLIPS, { variant: "classic", pure: true }).map((c) => c.id);
  assert.ok(!ids.includes("b"));
  assert.equal(ids.length, 4);
});

test("same-chair variant keeps one country only", () => {
  const ids = filterClips(CLIPS, { variant: "same-chair", country: "USSR" }).map((c) => c.id);
  assert.deepEqual(ids, ["d", "e"]);
});

test("questions per variant", () => {
  assert.deepEqual(questionsFor("classic"), ["decade", "country", "genre"]);
  assert.deepEqual(questionsFor("news-or-opinion"), ["genre"]);
  assert.deepEqual(questionsFor("same-chair"), ["decade"]);
});

test("max score per round matches the variant's questions plus bonus", () => {
  assert.equal(maxScorePerRound("classic"), 5);
  assert.equal(maxScorePerRound("news-or-opinion"), 1);
  assert.equal(maxScorePerRound("same-chair"), 2);
});

test("pickRounds never repeats a clip and caps at corpus size", () => {
  const rounds = pickRounds(CLIPS, 10, seededRng(5));
  assert.equal(rounds.length, 5);
  assert.equal(new Set(rounds.map((c) => c.id)).size, 5);
  assert.equal(pickRounds(CLIPS, 3, seededRng(5)).length, 3);
});

test("initial timbre: remembered choice if still offered, else the manifest's first", () => {
  const offered = [{ id: "hum" }, { id: "cello" }, { id: "brass" }];
  assert.equal(initialTimbre("cello", offered), "cello");
  assert.equal(initialTimbre("kazoo", offered), "hum");
  assert.equal(initialTimbre(null, offered), "hum");
  assert.equal(initialTimbre(null, []), "brass", "old manifests without a timbre list");
});

test("points notes for question titles come from POINTS, with the decade's one-off rule", () => {
  assert.equal(pointsNote("decade"), "2 pts, 1 if a decade off");
  assert.equal(pointsNote("country"), "1 pt");
  assert.equal(pointsNote("station"), "1 pt");
});

test("guessMark: right, one off (decade only), wrong, or unanswered, never colour alone", () => {
  assert.deepEqual(guessMark("decade", undefined, 0), { kind: "none", mark: "—" });
  assert.deepEqual(guessMark("decade", "1970s", 2), { kind: "good", mark: "✓" });
  assert.deepEqual(guessMark("decade", "1970s", 1), { kind: "near", mark: "◐", note: "one off" });
  assert.deepEqual(guessMark("decade", "1950s", 0), { kind: "bad", mark: "✕" });
  assert.deepEqual(guessMark("country", "US", 1), { kind: "good", mark: "✓" });
  assert.deepEqual(guessMark("country", "UK", 0), { kind: "bad", mark: "✕" });
});
