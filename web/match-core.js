// "Match the description" rules: descriptions, distractor choice, difficulty, scoring.
// Pure (no DOM), so it runs under `node --test` and in tools/check-pairs.mjs.
import { shuffle } from "./quiz-core.js";

/** Wording and scoring knobs; adjust here rather than in the game logic. */
export const MATCH_CONFIG = {
  countryAdjective: { US: "US", UK: "UK", USSR: "Soviet", Russia: "Russian" },
  // The corpus records USSR/Russia as one country so the answer can't leak the
  // decade; the description still names the state that existed at the time.
  sovietUntilYear: 1991,
  genreNoun: { news: "news report", opinion: "opinion piece" },
  // Used in "When only ___ differed" on the end screen.
  attributeLabel: { country: "the country", decade: "the decade", genre: "news vs opinion" },
  points: { easy: 1, medium: 2, hard: 3 },
  // A decade difference this many decades or more apart counts as two differences:
  // 1960s vs 2020s is far easier to hear than 1990s vs 2000s.
  decadeFarGap: 3,
  // Share of a game's rounds at each end of the ramp; the rest are medium.
  schedule: { easy: 0.3, hard: 0.3 },
};

export const ATTRIBUTES = ["country", "decade", "genre"];
export const LEVELS = ["easy", "medium", "hard"];
// When a level can't be supplied: try easier first, then harder, so a game never stalls.
const FALLBACK_ORDER = { easy: ["easy", "medium", "hard"], medium: ["medium", "easy", "hard"], hard: ["hard", "medium", "easy"] };

function countryAdjective(clip) {
  const { country } = clip.answer;
  if (country === "USSR/Russia") {
    const year = clip.year ?? parseInt(clip.answer.decade, 10);
    return year <= MATCH_CONFIG.sovietUntilYear ? "Soviet" : "Russian";
  }
  return MATCH_CONFIG.countryAdjective[country] ?? country;
}

/** The prompt's parts for a clip, plus the plain-text phrase ("UK news report from the 1970s"). */
export function describe(clip) {
  const country = countryAdjective(clip);
  const genre = MATCH_CONFIG.genreNoun[clip.answer.genre] ?? clip.answer.genre;
  const decade = clip.answer.decade;
  return { country, genre, decade, text: `${country} ${genre} from the ${decade}` };
}

/** Which of country, decade, genre differ between two clips. */
export function differingAttributes(a, b) {
  return ATTRIBUTES.filter((k) => a.answer[k] !== b.answer[k]);
}

/** How many decades apart two clips are (0 for the same decade). */
export function decadeGap(a, b) {
  return Math.abs(parseInt(a.answer.decade, 10) - parseInt(b.answer.decade, 10)) / 10;
}

/**
 * Differences that set difficulty: one each for country and news/opinion, and
 * for decade one when 1-2 decades apart or two when MATCH_CONFIG.decadeFarGap
 * or more apart.
 */
export function weightedDifferences(a, b) {
  const gap = decadeGap(a, b);
  const decade = gap === 0 ? 0 : gap >= MATCH_CONFIG.decadeFarGap ? 2 : 1;
  return (a.answer.country !== b.answer.country) + (a.answer.genre !== b.answer.genre) + decade;
}

/** Difficulty for a weighted difference count; null when nothing differs (not a valid pair). */
export function levelFor(differences) {
  if (differences >= 3) return "easy";
  return { 2: "medium", 1: "hard" }[differences] ?? null;
}

/** Levels for each round, easy first: 10 rounds -> 3 easy, 4 medium, 3 hard. */
export function difficultySchedule(rounds) {
  const easy = Math.ceil(rounds * MATCH_CONFIG.schedule.easy);
  const hard = Math.min(rounds - easy, Math.floor(rounds * MATCH_CONFIG.schedule.hard));
  const medium = rounds - easy - hard;
  return [...Array(easy).fill("easy"), ...Array(medium).fill("medium"), ...Array(hard).fill("hard")];
}

/**
 * Clips that can be the wrong answer for `correct` at a level, by weighted
 * differences (see weightedDifferences). Any valid distractor differs on at
 * least one described attribute. A clip by the same speaker only qualifies at
 * hard, where "same anchor, different decade" is interesting.
 */
export function candidateDistractors(correct, pool, level) {
  return pool.filter((d) => d.id !== correct.id &&
    levelFor(weightedDifferences(correct, d)) === level &&
    (level === "hard" || d.speaker !== correct.speaker));
}

function eligible(clips, pure) {
  return pure ? clips.filter((c) => c.recognizable !== "likely") : clips;
}

/** How many clips a match game with these settings can draw from (front-page status line). */
export function matchPoolSize(clips, { pure = false } = {}) {
  return eligible(clips, pure).length;
}

/**
 * Build a game's rounds.
 *
 * Each round takes an unused correct clip that can be paired at the scheduled
 * level; if none can, it falls back (easier first) and records why. Distractors
 * prefer a different speaker and never repeat in consecutive rounds.
 *
 * @returns {{rounds: object[], fallbacks: string[]}}
 */
export function buildMatchGame(clips, { rounds = 10, pure = false, rng = Math.random } = {}) {
  const pool = eligible(clips, pure);
  const schedule = difficultySchedule(Math.min(rounds, pool.length));
  const order = shuffle(pool, rng);
  const used = new Set();
  const out = [];
  const fallbacks = [];
  let previousDistractor = null;

  for (const [i, requested] of schedule.entries()) {
    let pick = null;
    for (const level of FALLBACK_ORDER[requested]) {
      for (const correct of order) {
        if (used.has(correct.id)) continue;
        const candidates = candidateDistractors(correct, pool, level).filter((d) => d.id !== previousDistractor);
        if (candidates.length === 0) continue;
        const otherSpeakers = candidates.filter((d) => d.speaker !== correct.speaker);
        const choices = otherSpeakers.length ? otherSpeakers : candidates;
        pick = { correct, distractor: choices[Math.floor(rng() * choices.length)], level };
        break;
      }
      if (pick) break;
    }
    if (!pick) {
      fallbacks.push(`round ${i + 1}: no pair available at any level; game ends early`);
      break;
    }
    if (pick.level !== requested) fallbacks.push(`round ${i + 1}: no ${requested} pair left; fell back to ${pick.level}`);
    used.add(pick.correct.id);
    previousDistractor = pick.distractor.id;
    out.push({
      ...pick,
      requestedLevel: requested,
      fellBack: pick.level !== requested,
      differs: differingAttributes(pick.correct, pick.distractor),
      decadeGap: decadeGap(pick.correct, pick.distractor),
      correctSide: rng() < 0.5 ? "A" : "B",
    });
  }
  return { rounds: out, fallbacks };
}

/** Points for a pick: the level's multiplier when right, else 0. */
export function scoreMatch(round, pickedSide) {
  const right = pickedSide === round.correctSide;
  return { right, points: right ? MATCH_CONFIG.points[round.level] : 0 };
}

/** Totals plus accuracy by level and, for hard rounds, by the one attribute that differed. */
export function summarizeMatch(results) {
  const byLevel = Object.fromEntries(LEVELS.map((l) => [l, { right: 0, total: 0 }]));
  const hardByAttribute = {};
  let total = 0;
  let max = 0;
  for (const r of results) {
    total += r.points;
    max += MATCH_CONFIG.points[r.level];
    byLevel[r.level].total += 1;
    byLevel[r.level].right += r.right ? 1 : 0;
    if (r.level === "hard") {
      const key = r.differs[0];
      hardByAttribute[key] ??= { right: 0, total: 0 };
      hardByAttribute[key].total += 1;
      hardByAttribute[key].right += r.right ? 1 : 0;
    }
  }
  return { total, max, byLevel, hardByAttribute };
}

/**
 * Corpus coverage: ordered (correct, distractor) pairs per level, clips that
 * have no partner at a level, and which single attribute separates hard pairs
 * (decade-only hard pairs are at most decadeFarGap - 1 decades apart).
 */
export function pairCoverage(clips, { pure = false } = {}) {
  const pool = eligible(clips, pure);
  const pairs = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  const unusable = Object.fromEntries(LEVELS.map((l) => [l, []]));
  const hardByAttribute = {};
  const hardDecadeGaps = {};
  for (const correct of pool) {
    for (const level of LEVELS) {
      const candidates = candidateDistractors(correct, pool, level);
      pairs[level] += candidates.length;
      if (candidates.length === 0) unusable[level].push(correct.id);
      if (level === "hard") {
        for (const d of candidates) {
          const key = differingAttributes(correct, d)[0];
          hardByAttribute[key] = (hardByAttribute[key] ?? 0) + 1;
          if (key === "decade") {
            const gap = decadeGap(correct, d);
            hardDecadeGaps[gap] = (hardDecadeGaps[gap] ?? 0) + 1;
          }
        }
      }
    }
  }
  return { clips: pool.length, pairs, unusable, hardByAttribute, hardDecadeGaps };
}

/**
 * "Stats for geeks" rows for a clip's speech stats (see pipeline/stats.py),
 * each with a label, a value with units, and a one-line plain-language hint.
 */
export function geekStatsRows(stats) {
  if (!stats) return [];
  // Fixed decimals so 5.0 doesn't print as "5" next to "4.9".
  const show = (value, unit, decimals = 1) =>
    (value === null || value === undefined ? "—" : `${Number(value).toFixed(decimals)} ${unit}`);

  return [
    { label: "Average pitch", value: show(stats.median_hz, "Hz", 0), hint: "median of the voiced moments" },
    { label: "Pitch range", value: show(stats.range_st, "semitones"), hint: "5th to 95th percentile; 12 semitones is an octave" },
    { label: "Pitch variation", value: show(stats.sd_st, "semitones"), hint: "standard deviation; low means monotone" },
    { label: "Speaking rate (rough)", value: show(stats.syllables_per_s, "syllables/s"), hint: "rough estimate from loudness peaks; pauses excluded" },
    // A rate, not a count: clips run 12-24 s, so raw counts would favour long clips.
    { label: "Pauses per minute", value: String(stats.pauses_per_min ?? "—"), hint: `silences of 0.2 s or more, per minute of the clip; ${stats.pause_pct}% of the clip is pause` },
    { label: "Average pause", value: show(stats.mean_pause_s, "s", 2), hint: "mean length of those silences" },
  ];
}
