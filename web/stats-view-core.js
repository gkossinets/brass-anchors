// Helpers for the results page (stats.html). Pure (no DOM), so it runs under `node --test`.
import { displayAnswer } from "./quiz-core.js";

const MODES = ["match", "classic", "language"];

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

/**
 * Where `you` ranks among other players' games. Your own game is usually in
 * `scores` already, so one copy of your score is left out; ties count half,
 * so matching everyone else is the 50th percentile.
 *
 * @returns {{others: number, percentile: number | null}} null when there's no one to compare with.
 */
export function compareToOthers(scores, you) {
  const others = [...scores];
  const own = others.indexOf(you);
  if (own !== -1) others.splice(own, 1);
  if (others.length === 0) return { others: 0, percentile: null };
  const below = others.filter((s) => s < you).length;
  const ties = others.filter((s) => s === you).length;
  return { others: others.length, percentile: Math.round((100 * (below + ties / 2)) / others.length) };
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

/** "Russian 3, French 1": the wrong guesses for one language, most common first. */
export function mistakenForText(counts) {
  const wrong = Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1]);
  return wrong.length ? wrong.map(([l, n]) => `${displayAnswer("language", l)} ${n}`).join(", ") : "—";
}
