// Shared per-round log format for both modes, play tracking, and mode routing.
// Pure (no DOM), so it runs under `node --test`.

/** Bump when the round record's shape changes; games saved before format 2 have no `format` field. */
export const LOG_FORMAT = 2;
const MODES = ["classic", "match", "language"];

/** Counts plays per clip and times from the first play; `now` is injectable for tests. */
export function createPlayLog(now = Date.now) {
  const plays = {};
  let first = null;
  return {
    played(id) {
      plays[id] = (plays[id] ?? 0) + 1;
      first ??= now();
    },
    counts: () => ({ ...plays }),
    allPlayed: (ids) => ids.every((id) => plays[id] > 0),
    msSinceFirstPlay: () => (first === null ? null : now() - first),
  };
}

/**
 * One round, in the same shape for every mode: shared fields first, then the
 * mode's own (classic and language: guess and score; match: difficulty, pair, pick).
 */
export function roundRecord(mode, { round, clipIds, plays, msToAnswer, timbre }, extra = {}) {
  return {
    format: LOG_FORMAT,
    mode,
    round,
    clip_ids: clipIds,
    plays,
    ms_first_play_to_answer: msToAnswer,
    timbre,
    ...extra,
  };
}

/** The mode named by `?mode=`, or null for the front page. The URL is the only source of truth. */
export function modeFromSearch(search) {
  const mode = new URLSearchParams(search).get("mode")?.toLowerCase();
  return MODES.includes(mode) ? mode : null;
}
