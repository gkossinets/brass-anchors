// Pure game logic: option generation, scoring, filtering. No DOM, so it runs under `node --test`.

export const DECADES = ["1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];
// Genre is what the clip is doing, not the speaker's job title: anchors, hosts
// and commentators all read from teleprompters, but reporting and arguing
// sound different.
export const GENRES = ["news", "opinion"];
const GENRE_LABELS = { news: "News", opinion: "Opinion" };
// Button order for the language game; the buttons never move between rounds.
export const LANGUAGES = ["en", "fr", "ru", "zh"];
const LANGUAGE_LABELS = { en: "English", fr: "French", ru: "Russian", zh: "Mandarin" };
// With two languages the game is a coin flip, so it waits for a third.
export const MIN_LANGUAGES = 3;

const QUESTIONS = {
  "classic": ["decade", "country", "genre"],
  // One country chosen on the front page: asking which country would give it away.
  "one-country": ["decade", "genre"],
  "language": ["language"],
};
// Country is worth 1 while the corpus is US/UK only: a two-way choice is a coin
// flip and shouldn't earn as much as an exact decade.
export const POINTS = { decade: 2, country: 1, genre: 1, station: 1, language: 1 };

/** mulberry32: small seedable PRNG so tests and replays are deterministic. */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates on a copy. */
export function shuffle(items, rng = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Correct decade plus three distractors from within three decades of it.
 * Jittered distance keeps nearest neighbours likely, so the question is never
 * trivially "the one decade that's close".
 */
export function decadeOptions(correct, rng = Math.random) {
  const ci = DECADES.indexOf(correct);
  const distractors = DECADES
    .filter((d, i) => d !== correct && Math.abs(i - ci) <= 3)
    .map((d) => ({ d, key: Math.abs(DECADES.indexOf(d) - ci) + rng() * 1.5 }))
    .sort((a, b) => a.key - b.key)
    .slice(0, 3)
    .map((x) => x.d);
  return [correct, ...distractors].sort((a, b) => DECADES.indexOf(a) - DECADES.indexOf(b));
}

function withDistractors(correct, pool, n, rng) {
  const others = shuffle([...new Set(pool)].filter((x) => x && x !== correct), rng).slice(0, n - 1);
  return shuffle([correct, ...others], rng);
}

/**
 * Countries that actually occur in the corpus (at most four, always including
 * the answer), in the order they first appear so the buttons never move.
 */
export function countryOptions(correct, corpusCountries, rng = Math.random) {
  const all = [...new Set(corpusCountries)];
  const others = shuffle(all.filter((c) => c !== correct), rng).slice(0, 3);
  return [correct, ...others].sort((a, b) => all.indexOf(a) - all.indexOf(b));
}

/** Correct station plus up to three other stations from the corpus. */
export function stationOptions(correct, corpusStations, rng = Math.random) {
  return withDistractors(correct, corpusStations, 4, rng);
}

/** Points per question; unanswered or unasked questions score zero. */
export function scoreRound(answer, guess) {
  const di = DECADES.indexOf(answer.decade);
  const gi = DECADES.indexOf(guess.decade);
  const decade = guess.decade === undefined ? 0
    : gi === di ? POINTS.decade
    : Math.abs(gi - di) === 1 ? 1 : 0;
  const country = guess.country === answer.country ? POINTS.country : 0;
  const genre = guess.genre === answer.genre ? POINTS.genre : 0;
  const station = guess.station === answer.station ? POINTS.station : 0;
  const language = guess.language !== undefined && guess.language === answer.language ? POINTS.language : 0;
  return { decade, country, genre, station, language, total: decade + country + genre + station + language };
}

export function questionsFor(variant) {
  return QUESTIONS[variant];
}

/** Guess the clip's variant for the front page's country choice ("both", or one country). */
export function clipVariant(country) {
  return country === "both" ? "classic" : "one-country";
}

/** Station bonus appears in Guess the clip, whichever countries it plays. */
export function hasBonus(variant) {
  return variant === "classic" || variant === "one-country";
}

/** Text beside Reveal: a count while answers are missing, then nothing. A longer line
 * would wrap the row on phones and move the button just as it lights up. */
export function roundHint(answered, total) {
  return answered < total ? `${answered} of ${total} answered.` : "";
}

export function maxScorePerRound(variant) {
  const main = questionsFor(variant).reduce((sum, q) => sum + POINTS[q], 0);
  return main + (hasBonus(variant) ? POINTS.station : 0);
}

/**
 * The clips the description and decade games play. Their questions (country,
 * decade, news or opinion) would be given away by the language, so they stay English.
 */
export function englishOnly(clips) {
  return clips.filter((c) => c.answer.language === "en");
}

/** Apply the game variant's clip restrictions. */
export function filterClips(clips, { variant, country }) {
  const pool = variant === "language" ? clips : englishOnly(clips);
  return pool.filter((c) => variant !== "one-country" || c.answer.country === country);
}

/** How many languages these clips cover. */
export function languageCount(clips) {
  return new Set(clips.map((c) => c.answer.language)).size;
}

/** The languages these clips cover, in LANGUAGES order. */
export function languageOptions(clips) {
  const present = new Set(clips.map((c) => c.answer.language));
  return LANGUAGES.filter((l) => present.has(l));
}

/**
 * Up to n clips for the language game, taken from each language in turn, so the
 * counts differ by at most one until a language runs out. Drawing from the whole
 * pool instead would make English, the biggest set, the safe guess.
 */
export function pickLanguageRounds(clips, n, rng = Math.random) {
  const byLanguage = shuffle(languageOptions(clips), rng)
    .map((l) => shuffle(clips.filter((c) => c.answer.language === l), rng));
  const picked = [];
  while (picked.length < n && byLanguage.some((pool) => pool.length)) {
    for (const pool of byLanguage) {
      if (picked.length < n && pool.length) picked.push(pool.pop());
    }
  }
  return shuffle(picked, rng);
}

/** Shuffled clips for one game, never repeating; fewer than n if the corpus is small. */
export function pickRounds(clips, n, rng = Math.random) {
  return shuffle(clips, rng).slice(0, n);
}

/** Timbre to start with: the viewer's remembered choice if the manifest still offers it. */
export function initialTimbre(remembered, offered) {
  if (offered.length === 0) return "brass";
  return offered.some((t) => t.id === remembered) ? remembered : offered[0].id;
}

/** How an answer value is shown on buttons and in the reveal table. */
export function displayAnswer(question, value) {
  if (question === "genre") return GENRE_LABELS[value] ?? value;
  if (question === "language") return LANGUAGE_LABELS[value] ?? value;
  return value;
}

/** A button's text: language buttons show a short code (EN, ZH) so all of them fit one row. */
export function buttonLabel(question, value) {
  if (question === "language") return value.toUpperCase();
  return displayAnswer(question, value);
}

/** The points note beside a question's title ("2 pts, 1 if a decade off"). */
export function pointsNote(question) {
  const pts = POINTS[question];
  const base = `${pts} pt${pts === 1 ? "" : "s"}`;
  return question === "decade" ? `${base}, 1 if a decade off` : base;
}

/**
 * How a guess reads on the reveal: a kind for colour and a mark so colour is
 * never the only signal. Only the decade can be partly right (one off).
 */
export function guessMark(question, guess, points) {
  if (guess === undefined) return { kind: "none", mark: "—" };
  if (points === POINTS[question]) return { kind: "good", mark: "✓" };
  if (points > 0) return { kind: "near", mark: "◐", note: "one off" };
  return { kind: "bad", mark: "✕" };
}
