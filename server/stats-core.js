// Summaries of the events table for `make stats`: what players get right and how long they take.
// Pure, so it runs under `node --test`; tools/stats.mjs feeds it rows from D1.

const LEVELS = ["easy", "medium", "hard"];
const QUESTIONS = ["decade", "country", "genre", "station"];
const FULL_POINTS = { decade: 2, country: 1, genre: 1, station: 1 }; // web/quiz-core.js POINTS
const LANGUAGES = ["en", "fr", "ru", "zh"]; // web/quiz-core.js LANGUAGES

/** Median of the numbers present (null and undefined skipped), or null if none. */
export function median(values) {
  const xs = values.filter((v) => typeof v === "number").sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function tally(groups) {
  return Object.fromEntries(Object.entries(groups).map(([key, rounds]) => [key, {
    n: rounds.length,
    right: rounds.filter((r) => r.right).length,
    medianMs: median(rounds.map((r) => r.ms_first_play_to_answer)),
  }]));
}

// Prototype-free, so a key like "__proto__" from a stored row is just a key.
function groupBy(items, keyOf) {
  const out = Object.create(null);
  for (const item of items) (out[keyOf(item)] ??= []).push(item);
  return out;
}

function summarizeMatch(rounds) {
  const byLevel = tally(groupBy(rounds, (r) => r.difficulty));
  const ordered = Object.fromEntries(LEVELS.filter((l) => byLevel[l]).map((l) => [l, byLevel[l]]));
  const hardByAttribute = tally(groupBy(rounds.filter((r) => r.difficulty === "hard"), (r) => r.differs?.[0]));
  // Unordered: telling x from y is one comparison whichever of them fit the description.
  const pairs = Object.entries(tally(groupBy(rounds.filter((r) => r.correct_id && r.distractor_id), (r) => [r.correct_id, r.distractor_id].sort().join(" | "))))
    .map(([key, t]) => ({ clips: key.split(" | "), ...t }))
    .sort((a, b) => a.right / a.n - b.right / b.n || (b.medianMs ?? 0) - (a.medianMs ?? 0));
  return { byLevel: ordered, hardByAttribute, pairs };
}

function summarizeClassic(rounds) {
  const byQuestion = {};
  for (const q of QUESTIONS) {
    const asked = rounds.filter((r) => r.guess?.[q] !== undefined);
    if (asked.length) byQuestion[q] = { n: asked.length, exact: asked.filter((r) => r.score?.[q] === FULL_POINTS[q]).length };
  }
  const byClip = Object.entries(groupBy(rounds, (r) => r.clip_id)).map(([clip, rs]) => ({
    clip,
    n: rs.length,
    meanPoints: rs.reduce((sum, r) => sum + (r.score?.total ?? 0), 0) / rs.length,
    exactShare: rs.reduce((sum, r) => sum + exactShare(r), 0) / rs.length,
    medianMs: median(rs.map((r) => r.ms_first_play_to_answer)),
  })).sort((a, b) => a.exactShare - b.exactShare || (b.medianMs ?? 0) - (a.medianMs ?? 0));
  return { byQuestion, byClip };
}

function summarizeLanguage(rounds) {
  const tallied = tally(groupBy(rounds.map((r) => ({ ...r, right: r.guess?.language === r.language })), (r) => r.language));
  const byLanguage = Object.fromEntries(LANGUAGES.filter((l) => tallied[l]).map((l) => [l, tallied[l]]));
  const mistakenFor = {};
  for (const r of rounds) {
    const guessed = r.guess?.language;
    if (guessed === undefined || guessed === r.language) continue;
    const counts = (mistakenFor[r.language] ??= {});
    counts[guessed] = (counts[guessed] ?? 0) + 1;
  }
  return { byLanguage, mistakenFor };
}

// Share of the questions asked that got full marks. Unlike points, it compares
// rounds across variants that ask different questions.
function exactShare(round) {
  const asked = QUESTIONS.filter((q) => round.guess?.[q] !== undefined);
  if (asked.length === 0) return 0;
  return asked.filter((q) => round.score?.[q] === FULL_POINTS[q]).length / asked.length;
}

// A claimed final score counts only if every round from 1 up arrived and their points add up
// to it, so one forged "100%" record can't move the distribution.
function backedByRounds(record, roundEvents) {
  const n = roundEvents.length;
  if (n === 0 || roundEvents.some((e) => e.round < 1 || e.round > n)) return false;
  const points = roundEvents.reduce((sum, e) => sum + (e.record.points ?? e.record.score?.total ?? 0), 0);
  return points === record.summary.total;
}

// A finished game's score as a whole percentage of its maximum; null for records without one.
function scorePct(record) {
  const { total, max } = record.summary ?? {};
  return typeof total === "number" && max > 0 ? Math.round((100 * total) / max) : null;
}

// Match and Guess the clip play the same English clips; the language game mostly others.
/**
 * Match games scored before log format 3, when a right pick was worth 1-3 points
 * by difficulty. Match stats restarted with the one-point scoring, so these are
 * left out of Match accuracy and scores (their notes still count).
 */
function oldScoringMatchGames(events) {
  return new Set(events.filter((e) => e.kind === "round" && e.mode === "match" && !(e.record.format >= 3)).map((e) => e.game));
}

const clipFamily = (mode) => (mode === "language" ? "language" : "english");

/**
 * Each player's first game of each clip family: the one whose earliest event came
 * first. Later games replay clips the player has already heard (a 10-round Match
 * game plays all 20 English clips), so they'd make comparisons look easier than they are.
 */
function firstGames(events) {
  const startOf = {};
  for (const e of events) {
    const s = startOf[e.game];
    if (!s || e.received_at < s.at) startOf[e.game] = { key: `${e.player} ${clipFamily(e.mode)}`, at: e.received_at };
  }
  const first = {};
  for (const [game, { key, at }] of Object.entries(startOf)) {
    if (!first[key] || at < first[key].at) first[key] = { game, at };
  }
  return new Set(Object.values(first).map((f) => f.game));
}

// Rows with their payload parsed; rows whose payload isn't JSON are counted and dropped.
function parseRows(rows) {
  let skipped = 0;
  const all = [];
  for (const row of rows) {
    try {
      all.push({ ...row, record: JSON.parse(row.payload) });
    } catch {
      skipped += 1;
    }
  }
  return { all, skipped };
}

const countedGames = (events, firstGamesOnly) => (firstGamesOnly ? firstGames(events) : new Set(events.map((e) => e.game)));

// Round events, each game's round once: a round can be sent twice.
function uniqueRounds(events) {
  const seen = new Set();
  return events.filter((e) => {
    if (e.kind !== "round") return false;
    const key = `${e.game}#${e.round}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The round events summarize counts ({...row, record}), for other summaries of the same rows. */
export function countedRounds(rows, { firstGamesOnly = true } = {}) {
  const { all } = parseRows(rows);
  const counted = countedGames(all, firstGamesOnly);
  return uniqueRounds(all.filter((e) => counted.has(e.game)));
}

/**
 * Summarize event rows ({kind, player, game, mode, round, received_at, payload}).
 * A round sent twice counts once. Each game sends its record when it finishes and
 * again when the player saves notes; the latest record per game counts. By default
 * only each player's first game counts (see firstGames); players and games still
 * count everything, and `replays` says how many games were left out.
 */
export function summarize(rows, { firstGamesOnly = true } = {}) {
  const { all, skipped } = parseRows(rows);
  const counted = countedGames(all, firstGamesOnly);
  const oldMatch = oldScoringMatchGames(all);
  const events = all.filter((e) => counted.has(e.game));
  const rounds = uniqueRounds(events);
  const latestGame = {};
  for (const e of events.filter((ev) => ev.kind === "game")) {
    if (!latestGame[e.game] || e.received_at > latestGame[e.game].received_at) latestGame[e.game] = e;
  }
  const finishedGames = Object.values(latestGame);
  const roundsByGame = groupBy(rounds, (e) => e.game);
  const scores = { match: [], classic: [], language: [] };
  let unbacked = 0;
  for (const e of finishedGames) {
    const p = scorePct(e.record);
    if (p === null || !scores[e.mode] || oldMatch.has(e.game)) continue;
    if (backedByRounds(e.record, roundsByGame[e.game] ?? [])) scores[e.mode].push(p);
    else unbacked += 1;
  }
  for (const list of Object.values(scores)) list.sort((a, b) => a - b);
  const notes = finishedGames
    .filter((e) => typeof e.record.cues === "string" && e.record.cues.trim())
    .sort((a, b) => a.received_at.localeCompare(b.received_at))
    .map((e) => ({ at: e.received_at, mode: e.mode, text: e.record.cues.trim() }));

  return {
    players: new Set(all.map((e) => e.player)).size,
    games: new Set(all.map((e) => e.game)).size,
    counted: counted.size,
    replays: new Set(all.map((e) => e.game)).size - counted.size,
    finished: finishedGames.length,
    scores,
    unbacked,
    skipped,
    oldMatchGames: oldMatch.size,
    match: summarizeMatch(rounds.filter((e) => e.mode === "match" && !oldMatch.has(e.game)).map((e) => e.record)),
    classic: summarizeClassic(rounds.filter((e) => e.mode === "classic").map((e) => e.record)),
    language: summarizeLanguage(rounds.filter((e) => e.mode === "language").map((e) => e.record)),
    notes,
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pct = (part, whole) => `${Math.round((100 * part) / whole)}%`;
const secs = (ms) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`);
const row = (label, t) => `  ${label.padEnd(10)} ${`${t.right}/${t.n}`.padStart(7)}  ${pct(t.right, t.n).padStart(4)}  ${secs(t.medianMs).padStart(7)}`;

/** Plain-text report for the terminal. Times are median ms from first Play to answer. */
export function formatReport(s, { topPairs = 10 } = {}) {
  const lines = [`${plural(s.players, "player")}, ${plural(s.games, "game")}, ${s.finished} finished` +
    (s.replays ? `; ${plural(s.replays, "replay")} left out (only each player's first game counts)` : "") +
    (s.unbacked ? ` (${s.unbacked} with scores their rounds don't support, left out of the distribution)` : "") +
    (s.skipped ? ` (${s.skipped} unreadable rows skipped)` : "") +
    (s.oldMatchGames ? `; ${plural(s.oldMatchGames, "Match game")} from before the scoring change left out` : "")];

  const levels = Object.entries(s.match.byLevel);
  if (levels.length) {
    lines.push("", "Match the clue             right   acc  median time");
    for (const [level, t] of levels) lines.push(row(level, t));
    const attrs = Object.entries(s.match.hardByAttribute);
    if (attrs.length) {
      lines.push("", "Hard rounds, by what differed");
      for (const [attr, t] of attrs) lines.push(row(attr, t));
    }
    lines.push("", `Hardest pairs (of ${s.match.pairs.length})`);
    for (const p of s.match.pairs.slice(0, topPairs)) {
      lines.push(`  ${`${p.right}/${p.n}`.padStart(5)}  ${pct(p.right, p.n).padStart(4)}  ${secs(p.medianMs).padStart(7)}  ${p.clips.join("  vs  ")}`);
    }
  }

  const questions = Object.entries(s.classic.byQuestion);
  if (questions.length) {
    lines.push("", "Guess the clip: exact answers");
    for (const [q, t] of questions) lines.push(`  ${q.padEnd(10)} ${`${t.exact}/${t.n}`.padStart(7)}  ${pct(t.exact, t.n).padStart(4)}`);
    lines.push("", "Clips, lowest score first   rounds  points  median time");
    for (const c of s.classic.byClip) lines.push(`  ${c.clip.padEnd(26)} ${String(c.n).padStart(5)}  ${c.meanPoints.toFixed(1).padStart(6)}  ${secs(c.medianMs).padStart(7)}`);
  }

  const languages = Object.entries(s.language.byLanguage);
  if (languages.length) {
    lines.push("", "Guess the language         right   acc  median time  mistaken for");
    for (const [lang, t] of languages) {
      const wrong = Object.entries(s.language.mistakenFor[lang] ?? {}).sort((a, b) => b[1] - a[1]);
      lines.push(`${row(lang, t)}  ${wrong.map(([g, n]) => `${g} ${n}`).join(", ")}`);
    }
  }

  if (s.notes.length) {
    lines.push("", "Notes");
    for (const n of s.notes) lines.push(`  ${n.at.slice(0, 16).replace("T", " ")}  ${n.mode}: ${n.text.replace(/\s+/g, " ")}`);
  }
  return lines.join("\n");
}

/**
 * What the public stats page shows: no notes, no player or game ids. Pairs and
 * clips need `minAttempts` plays to be ranked; the easiest and hardest lists never
 * share an entry.
 */
export function publicSummary(rows, { minAttempts = 3, top = 5 } = {}) {
  const s = summarize(rows, { firstGamesOnly: true });
  const ranked = (list) => {
    const enough = list.filter((x) => x.n >= minAttempts);
    const hardest = enough.slice(0, Math.min(top, Math.ceil(enough.length / 2)));
    const easiest = enough.slice(hardest.length).reverse().slice(0, top);
    return { hardest, easiest };
  };
  const pairs = ranked(s.match.pairs);
  const clips = ranked(s.classic.byClip);
  return {
    players: s.players,
    games: s.games,
    counted: s.counted,
    replays: s.replays,
    finished: s.finished,
    scores: s.scores,
    minAttempts,
    match: { byLevel: s.match.byLevel, hardByAttribute: s.match.hardByAttribute, ...pairs },
    classic: { byQuestion: s.classic.byQuestion, ...clips },
    language: s.language,
  };
}
