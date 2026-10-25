// Which clips players miss most, one list per game, for the clip stats page (/api/clip-stats).
// Every game counts, replays included: unlike the results page, this list is meant to fill
// quickly, and a clip that stays hard on a second hearing is still hard. Pure, for `node --test`.
import { countedRounds } from "./stats-core.js";

const MAIN_QUESTIONS = ["decade", "country", "genre"]; // the station bonus doesn't count

// Each game's rule for which clip a round is about and whether the player missed it.
const MISS_RULES = {
  language: (r) => ({ clip: r.clip_id, missed: r.guess?.language !== r.language }),
  // Only the questions the round asked: one-country games don't ask the country. A decade
  // one off still earns a point, so only a question scored zero is a miss.
  classic: (r) => ({ clip: r.clip_id, missed: MAIN_QUESTIONS.some((q) => r.guess?.[q] !== undefined && r.score?.[q] === 0) }),
  // A wrong pick counts against the clip that fit the description.
  match: (r) => ({ clip: r.correct_id, missed: r.right === false }),
};

function hardest(records, rule, minAttempts, top) {
  const byClip = Object.create(null); // a clip id like "__proto__" is just a key
  for (const record of records) {
    const { clip, missed } = rule(record);
    if (!clip) continue;
    const t = (byClip[clip] ??= { clip, n: 0, missed: 0 });
    t.n += 1;
    if (missed) t.missed += 1;
  }
  return Object.values(byClip)
    .filter((t) => t.n >= minAttempts)
    .sort((a, b) => b.missed / b.n - a.missed / a.n || b.n - a.n || a.clip.localeCompare(b.clip))
    .slice(0, top);
}

// What language each language was guessed as, right guesses included, so the page can draw
// a full confusion matrix: guessedAs[truth][guess] = rounds.
function guessedAs(records) {
  const counts = Object.create(null);
  for (const r of records) {
    const guess = r.guess?.language;
    if (!r.language || !guess) continue;
    const row = (counts[r.language] ??= Object.create(null));
    row[guess] = (row[guess] ?? 0) + 1;
  }
  return counts;
}

/**
 * Each game's hardest clips ({clip, n, missed}, hardest first) from event rows, plus what each
 * language was guessed as in Guess the language. Aggregates only: no player or game ids.
 */
export function clipDifficulty(rows, { minAttempts = 3, top = 5 } = {}) {
  const rounds = countedRounds(rows, { firstGamesOnly: false });
  const recordsOf = (mode) => rounds.filter((e) => e.mode === mode).map((e) => e.record);
  return {
    minAttempts,
    rounds: rounds.length,
    language: {
      hardest: hardest(recordsOf("language"), MISS_RULES.language, minAttempts, top),
      guessedAs: guessedAs(recordsOf("language")),
    },
    match: { hardest: hardest(recordsOf("match"), MISS_RULES.match, minAttempts, top) },
    classic: { hardest: hardest(recordsOf("classic"), MISS_RULES.classic, minAttempts, top) },
  };
}
