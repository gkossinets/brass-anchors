// Checks one event sent by the game to /api/log and turns it into a database row.
// Pure (no Cloudflare APIs), so it runs under `node --test`.

// A game record with 50 rounds is about 15 KB; anything far bigger is not from the game.
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_NOTES_CHARS = 4000;
export const MAX_ROUNDS = 100;

const KINDS = ["round", "game"];
// Mirrors MATCH_CONFIG.points in web/match-core.js and POINTS in web/quiz-core.js.
const LEVEL_POINTS = { easy: 1, medium: 2, hard: 3 };
const MAX_CLASSIC_ROUND_POINTS = 5; // decade 2 + country 1 + genre 1 + station bonus 1
// Faster than this, nobody has listened: a match pick needs both clips started.
const MIN_ANSWER_MS = 1000;
const MAX_ANSWER_MS = 60 * 60 * 1000;
// Not a name every object inherits: summaries key objects by clip id.
const CLIP_ID = /^(?!(?:__proto__|constructor|prototype)$)[a-z0-9_]{1,64}$/;
const MODES = ["classic", "match", "language"];
const LANGUAGES = ["en", "fr", "ru", "zh"]; // web/quiz-core.js LANGUAGES
// Player and game ids are crypto.randomUUID() values made in the browser.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const fail = (error) => ({ ok: false, error });
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Parse and check a request body.
 *
 * @returns {{ok: true, row: {kind, player, game, mode, round, payload}} | {ok: false, error: string}}
 */
export function parseEvent(text) {
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail(`body over ${MAX_BODY_BYTES} bytes`);
  let event;
  try {
    event = JSON.parse(text);
  } catch {
    return fail("body is not JSON");
  }
  if (!isObject(event)) return fail("body is not a JSON object");
  const { kind, player, game, mode, record } = event;
  if (!KINDS.includes(kind)) return fail(`unknown kind ${JSON.stringify(kind)}`);
  if (!MODES.includes(mode)) return fail(`unknown mode ${JSON.stringify(mode)}`);
  if (!UUID.test(player ?? "")) return fail("player id is not a UUID");
  if (!UUID.test(game ?? "")) return fail("game id is not a UUID");
  if (!isObject(record)) return fail("record is not an object");
  if (record.mode !== mode) return fail("record mode differs from event mode");

  let round = null;
  if (kind === "round") {
    round = record.round;
    if (!Number.isInteger(round) || round < 1 || round > MAX_ROUNDS) return fail("round number out of range");
    const problem = mode === "match" ? matchRoundProblem(record)
      : mode === "language" ? languageRoundProblem(record)
      : classicRoundProblem(record);
    if (problem) return fail(problem);
  }
  if (typeof record.cues === "string" && record.cues.length > MAX_NOTES_CHARS) return fail("notes too long");

  return { ok: true, row: { kind, player, game, mode, round, payload: JSON.stringify(record) } };
}

const plausibleMs = (ms) => typeof ms === "number" && ms >= MIN_ANSWER_MS && ms <= MAX_ANSWER_MS;

// These checks can't stop a determined script, only sloppy or impossible records;
// see PROJECT.md (Key decisions: Site and data) for what else limits fake results.
function matchRoundProblem(r) {
  if (!Object.hasOwn(LEVEL_POINTS, r.difficulty ?? "")) return "unknown difficulty";
  if (typeof r.right !== "boolean") return "right is not true or false";
  // Format 3 dropped the difficulty multiplier; older games keep the points they were played for.
  const pointsIfRight = r.format >= 3 ? 1 : LEVEL_POINTS[r.difficulty];
  if (r.points !== (r.right ? pointsIfRight : 0)) return "points don't match the scoring";
  if (!CLIP_ID.test(r.correct_id ?? "") || !CLIP_ID.test(r.distractor_id ?? "")) return "bad clip id";
  if (!plausibleMs(r.ms_first_play_to_answer)) return "implausible answer time";
  return null;
}

function classicRoundProblem(r) {
  if (!CLIP_ID.test(r.clip_id ?? "")) return "bad clip id";
  const total = r.score?.total;
  if (!Number.isInteger(total) || total < 0 || total > MAX_CLASSIC_ROUND_POINTS) return "score out of range";
  // Null when the player answered without pressing Play.
  if (r.ms_first_play_to_answer !== null && !plausibleMs(r.ms_first_play_to_answer)) return "implausible answer time";
  return null;
}

function languageRoundProblem(r) {
  if (!CLIP_ID.test(r.clip_id ?? "")) return "bad clip id";
  if (!LANGUAGES.includes(r.language) || !LANGUAGES.includes(r.guess?.language)) return "unknown language";
  if (r.score?.total !== (r.guess.language === r.language ? 1 : 0)) return "score doesn't match the guess";
  if (r.ms_first_play_to_answer !== null && !plausibleMs(r.ms_first_play_to_answer)) return "implausible answer time";
  return null;
}
