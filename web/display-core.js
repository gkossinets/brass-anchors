// Small display helpers for the screens (clock, round segments, score). Pure, so it runs under `node --test`.

// Above this many rounds the header shows "Round 13 of 20" instead of segments.
export const MAX_SEGMENTS = 12;

/** Seconds as m:ss ("0:07"); unknown or infinite durations show as 0:00. */
export function formatClock(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Header progress for round `current` (1-based) of `total`: each segment is
 * "done", "current", or "todo". Once the round is answered (`answered`), it counts
 * as done. Null when there are too many rounds to draw.
 */
export function roundSegments(total, current, answered) {
  if (total > MAX_SEGMENTS) return null;
  return Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    if (n < current || (n === current && answered)) return "done";
    return n === current ? "current" : "todo";
  });
}

/** "7 / 9" -> { got: "7", max: "9" }, so the end screen can mute the maximum. */
export function splitScore(text) {
  const m = /^\s*(\S+)\s*\/\s*(\S+)\s*$/.exec(text);
  return m ? { got: m[1], max: m[2] } : { got: text, max: null };
}
