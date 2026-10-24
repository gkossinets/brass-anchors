import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DECADES, GENRES, seededRng, shuffle, decadeOptions, countryOptions, stationOptions,
  scoreRound, filterClips, questionsFor, clipVariant, pickRounds, maxScorePerRound, initialTimbre, displayAnswer, buttonLabel, pointsNote, guessMark,
  englishOnly, languageOptions, pickLanguageRounds, languageCount, MIN_LANGUAGES, roundHint, canReveal } from "./quiz-core.js";

const clip = (id, country, decade, genre, station, recognizable = "unlikely", language = "en") =>
  ({ id, answer: { country, language, decade, genre, station }, recognizable });

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
    { decade: 2, country: 1, genre: 1, station: 1, language: 0, total: 5 },
  );
  assert.deepEqual(
    scoreRound(answer, { decade: "1980s", country: "UK", genre: "opinion", station: "BBC" }),
    { decade: 1, country: 0, genre: 0, station: 0, language: 0, total: 1 },
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

test("recognizable voices stay in: there's no pure mode any more", () => {
  const ids = filterClips(CLIPS, { variant: "classic", pure: true }).map((c) => c.id);
  assert.ok(ids.includes("b"));
});

test("one-country game keeps that country's clips only", () => {
  const ids = filterClips(CLIPS, { variant: "one-country", country: "USSR" }).map((c) => c.id);
  assert.deepEqual(ids, ["d", "e"]);
});

test("questions per variant: one country drops the country question", () => {
  assert.deepEqual(questionsFor("classic"), ["decade", "country", "genre"]);
  assert.deepEqual(questionsFor("one-country"), ["decade", "genre"]);
  assert.equal(questionsFor("news-or-opinion"), undefined, "retired variant");
  assert.equal(questionsFor("same-chair"), undefined, "retired variant");
});

test("max score per round matches the variant's questions plus bonus", () => {
  assert.equal(maxScorePerRound("classic"), 5);
  assert.equal(maxScorePerRound("one-country"), 4);
});

test("guess the clip variant from the country choice", () => {
  assert.equal(clipVariant("both"), "classic");
  assert.equal(clipVariant("UK"), "one-country");
  assert.equal(clipVariant("US"), "one-country");
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

// Four languages, unevenly stocked the way the real corpus is: twice as much English.
const MIXED = [
  ...["e1", "e2", "e3", "e4", "e5", "e6"].map((id) => clip(id, "US", "1990s", "news", "CBS")),
  clip("f1", "France", "1970s", "news", "ORTF", "unlikely", "fr"),
  clip("f2", "France", "1980s", "news", "TF1", "likely", "fr"),
  clip("f3", "France", "2000s", "opinion", "TF1", "unlikely", "fr"),
  clip("r1", "USSR/Russia", "1980s", "news", "Central Television", "unlikely", "ru"),
  clip("r2", "USSR/Russia", "1990s", "news", "NTV", "unlikely", "ru"),
  clip("r3", "USSR/Russia", "2010s", "news", "Channel One", "unlikely", "ru"),
  clip("z1", "China", "1980s", "news", "CCTV", "unlikely", "zh"),
  clip("z2", "China", "2000s", "news", "CCTV", "unlikely", "zh"),
  clip("z3", "China", "2010s", "news", "CCTV", "unlikely", "zh"),
];

test("the description and decade games play English clips only", () => {
  const ids = filterClips(MIXED, { variant: "classic" }).map((c) => c.id);
  assert.deepEqual(ids, ["e1", "e2", "e3", "e4", "e5", "e6"]);
  assert.deepEqual(filterClips(MIXED, { variant: "one-country", country: "France" }), []);
  assert.deepEqual(englishOnly(MIXED).map((c) => c.answer.country), Array(6).fill("US"));
});

test("the language game draws on every language", () => {
  assert.equal(filterClips(MIXED, { variant: "language" }).length, 15);
});

test("the language game asks one question worth 1 point, with no bonus", () => {
  assert.deepEqual(questionsFor("language"), ["language"]);
  assert.equal(maxScorePerRound("language"), 1);
  assert.equal(pointsNote("language"), "1 pt");
  const answer = MIXED[6].answer;
  assert.equal(scoreRound(answer, { language: "fr" }).total, 1);
  assert.equal(scoreRound(answer, { language: "en" }).total, 0);
  assert.equal(scoreRound(answer, {}).language, 0);
});

test("language buttons: every language in the corpus, in a fixed order, with names", () => {
  assert.deepEqual(languageOptions(MIXED), ["en", "fr", "ru", "zh"]);
  assert.deepEqual(languageOptions(MIXED.slice(0, 12)), ["en", "fr", "ru"]);
  assert.equal(displayAnswer("language", "zh"), "Mandarin");
  assert.equal(displayAnswer("language", "en"), "English");
});

test("language buttons show a short code; other buttons show the usual label", () => {
  assert.equal(buttonLabel("language", "zh"), "ZH");
  assert.equal(buttonLabel("language", "en"), "EN");
  assert.equal(buttonLabel("genre", "news"), "News");
  assert.equal(buttonLabel("decade", "1990s"), "1990s");
});

test("language rounds are spread evenly across languages, so always guessing English doesn't pay", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const rounds = pickLanguageRounds(MIXED, 8, seededRng(seed));
    assert.equal(rounds.length, 8);
    assert.equal(new Set(rounds.map((c) => c.id)).size, 8);
    const counts = {};
    for (const c of rounds) counts[c.answer.language] = (counts[c.answer.language] ?? 0) + 1;
    assert.deepEqual(Object.values(counts), [2, 2, 2, 2]);
  }
});

test("language rounds: an uneven count differs by at most one per language, then the bigger pools fill in", () => {
  const counts = (rounds) => {
    const out = { en: 0, fr: 0, ru: 0, zh: 0 };
    for (const c of rounds) out[c.answer.language] += 1;
    return Object.values(out).sort();
  };
  assert.deepEqual(counts(pickLanguageRounds(MIXED, 10, seededRng(3))), [2, 2, 3, 3]);
  // Only English has more than 3 clips, so a 15-round game uses all of them.
  assert.deepEqual(counts(pickLanguageRounds(MIXED, 15, seededRng(3))), [3, 3, 3, 6]);
  assert.equal(pickLanguageRounds(MIXED, 40, seededRng(3)).length, 15);
});

test("language rounds come in shuffled order, not one language after another", () => {
  const orders = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    orders.add(pickLanguageRounds(MIXED, 4, seededRng(seed)).map((c) => c.answer.language).join());
  }
  assert.ok(orders.size > 5);
});

test("the language game needs clips in at least three languages", () => {
  assert.equal(MIN_LANGUAGES, 3);
  assert.equal(languageCount(MIXED), 4);
  assert.equal(languageCount(englishOnly(MIXED)), 1);
});

test("round hint counts answers, then goes blank: a lit Reveal button says enough", () => {
  assert.equal(roundHint(0, 1, true), "0 of 1 answered.");
  assert.equal(roundHint(2, 3, true), "2 of 3 answered.");
  assert.equal(roundHint(3, 3, true), "");
});

test("round hint asks for a play first, even once every question is answered", () => {
  assert.equal(roundHint(0, 1, false), "Play the clip, then answer.");
  assert.equal(roundHint(1, 1, false), "Play the clip, then answer.");
});

test("Reveal needs the clip played and every question answered", () => {
  assert.equal(canReveal(1, 1, true), true);
  assert.equal(canReveal(1, 1, false), false);
  assert.equal(canReveal(2, 3, true), false);
});
