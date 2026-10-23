// Helpers for the results page (stats.html). Pure (no DOM), so it runs under `node --test`.

const MODES = ["match", "classic"];

/** Ten 10-point bins of final scores (whole percentages); 100% goes in the top bin. */
export function histogram(scores) {
  const bins = Array.from({ length: 10 }, (_, i) => ({
    from: i * 10,
    to: i === 9 ? 100 : i * 10 + 9,
    label: i === 9 ? "90-100%" : `${i * 10}-${i * 10 + 9}%`,
    count: 0,
  }));
  for (const s of scores) bins[Math.min(9, Math.floor(s / 10))].count += 1;
  return bins;
}

/** Percentage of games that scored lower than `you`, or null with no games. */
export function percentBelow(scores, you) {
  if (scores.length === 0) return null;
  return Math.round((100 * scores.filter((s) => s < you).length) / scores.length);
}

/** "Walter Cronkite (CBS, 1978)"; falls back to the decade, or to the id for a clip no longer in the game. */
export function clipLabel(id, clipsById) {
  const c = clipsById[id];
  if (!c) return id;
  return `${c.speaker} (${c.answer.station}, ${c.year ?? c.answer.decade})`;
}

/** Which mode's results to show, and the player's own score if the end screen passed one. */
export function pageParams(search) {
  const params = new URLSearchParams(search);
  const mode = MODES.includes(params.get("mode")) ? params.get("mode") : "match";
  const raw = params.get("you");
  const you = raw !== null && /^\d{1,3}$/.test(raw) && Number(raw) <= 100 ? Number(raw) : null;
  return { mode, you };
}

export function pct(part, whole) {
  return whole ? `${Math.round((100 * part) / whole)}%` : "—";
}
