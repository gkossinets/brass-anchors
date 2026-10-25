// Clip stats page rules: grouping clips, group medians, standouts, chart axes.
// Pure (no DOM), so it runs under `node --test`.

import { LANGUAGES } from "./quiz-core.js";

/**
 * The measurements shown, from each clip's `stats`. Pitch is always split by sex
 * (it differs far more by sex than by language); `sex` limits a measure to one.
 * Speaking rate is left out: it's calibrated on English only.
 */
export const MEASURES = [
  { id: "pitch_f", key: "median_hz", label: "Average pitch, women", short: "Pitch, women", unit: " Hz", digits: 0, sex: "f", inTable: true },
  { id: "pitch_m", key: "median_hz", label: "Average pitch, men", short: "Pitch, men", unit: " Hz", digits: 0, sex: "m", inTable: true },
  { id: "range", key: "range_st", label: "Pitch range", short: "Pitch range", unit: " st", digits: 1, inTable: true },
  { id: "variation", key: "sd_st", label: "Pitch variation", short: "Pitch variation", unit: " st", digits: 1, inTable: false },
  { id: "pauses", key: "pauses_per_min", label: "Pauses per minute", short: "Pauses / min", unit: "", digits: 0, inTable: true },
  { id: "pause_len", key: "mean_pause_s", label: "Average pause", short: "Avg pause", unit: " s", digits: 2, inTable: true },
  { id: "silent", key: "pause_pct", label: "Time silent", short: "Time silent", unit: "%", digits: 0, inTable: true },
];
// Grouped by sex, each group is one sex, so one pitch measure does.
const PITCH = { id: "pitch", key: "median_hz", label: "Average pitch", short: "Pitch", unit: " Hz", digits: 0, inTable: true };

const BYS = ["language", "decade", "sex"];
const LANGUAGE_GROUPS = ["English US", "English UK", "French", "Russian", "Mandarin"];
const LANGUAGE_NAMES = { fr: "French", ru: "Russian", zh: "Mandarin" };
const SEX_GROUPS = { f: "Women", m: "Men" };

/** The grouping in the page's URL (`?by=decade`); language unless it names another. */
export function parseBy(search) {
  const by = new URLSearchParams(search).get("by");
  return BYS.includes(by) ? by : "language";
}

/** The measures for a grouping: the two pitch measures become one when grouping by sex. */
export function measuresFor(by) {
  if (by !== "sex") return MEASURES;
  return [PITCH, ...MEASURES.filter((m) => !m.sex)];
}

/** A clip's group: English splits into US and UK, the comparison the game is built on. */
export function groupOf(clip, by) {
  if (by === "decade") return clip.answer.decade;
  if (by === "sex") return SEX_GROUPS[clip.sex] ?? "Unknown";
  const { language, country } = clip.answer;
  return language === "en" ? `English ${country}` : LANGUAGE_NAMES[language] ?? language;
}

/** The groups present, in display order. */
export function groupOrder(clips, by) {
  const present = new Set(clips.map((c) => groupOf(c, by)));
  if (by === "language") return LANGUAGE_GROUPS.filter((g) => present.has(g));
  if (by === "sex") return Object.values(SEX_GROUPS).filter((g) => present.has(g));
  return [...present].sort();
}

function median(values) {
  const xs = values.filter((v) => typeof v === "number").sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** A clip's value for a measure, or null when it has none or the measure is for the other sex. */
export function valueOf(clip, measure) {
  if (measure.sex && clip.sex !== measure.sex) return null;
  const v = clip.stats?.[measure.key];
  return typeof v === "number" ? v : null;
}

/** One row per group: its clip count and the median of each measure (null where no clip has one). */
export function groupRows(clips, by) {
  const measures = measuresFor(by);
  return groupOrder(clips, by).map((group) => {
    const members = clips.filter((c) => groupOf(c, by) === group);
    const medians = Object.fromEntries(measures.map((m) => [m.id, median(members.map((c) => valueOf(c, m)))]));
    return { group, n: members.length, medians };
  });
}

/** "16.9 st", "0.40 s", "—" for no value. */
export function formatValue(value, measure) {
  return value === null || value === undefined ? "—" : `${value.toFixed(measure.digits)}${measure.unit}`;
}

/** A chart's one-line caption from its group medians: the highest and lowest group. */
export function chartCaption(rows, measure) {
  const withValue = rows.filter((r) => r.medians[measure.id] !== null && r.medians[measure.id] !== undefined);
  if (withValue.length === 0) return "";
  if (withValue.length === 1) return `Only ${withValue[0].group} has a value.`;
  const sorted = [...withValue].sort((a, b) => b.medians[measure.id] - a.medians[measure.id]);
  const [top, bottom] = [sorted[0], sorted[sorted.length - 1]];
  return `Highest: ${top.group}, ${formatValue(top.medians[measure.id], measure)}. ` +
    `Lowest: ${bottom.group}, ${formatValue(bottom.medians[measure.id], measure)}.`;
}

const STANDOUTS = [
  { label: "Widest pitch range", key: "range_st", most: true },
  { label: "Narrowest pitch range", key: "range_st", most: false },
  { label: "Most pauses", key: "pauses_per_min", most: true },
  { label: "Fewest pauses", key: "pauses_per_min", most: false },
  { label: "Most time silent", key: "pause_pct", most: true },
  { label: "Longest pauses", key: "mean_pause_s", most: true },
];

/** The record-holders over every clip: {label, key (the stats field), clip, value}. */
export function standouts(clips) {
  return STANDOUTS.flatMap(({ label, key, most }) => {
    const withValue = clips.filter((c) => typeof c.stats?.[key] === "number");
    if (withValue.length === 0) return [];
    const best = withValue.reduce((a, b) => (most ? b.stats[key] > a.stats[key] : b.stats[key] < a.stats[key]) ? b : a);
    return [{ label, key, clip: best, value: best.stats[key] }];
  });
}

// 1, 2, or 5 times a power of ten: the round step at or above x.
function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= x);
}

/** A chart axis with room on both sides of the data: round ends, a tick at each end and the middle. */
export function axis(values) {
  const min = Math.min(...values), max = Math.max(...values);
  const step = niceStep(Math.max(max - min, 1) / 6);
  let lo = Math.floor(min / step) * step;
  if (lo >= min) lo -= step;
  let hi = Math.ceil(max / step) * step;
  if (hi <= max) hi += step;
  lo = Math.max(0, lo);
  return { lo, hi, ticks: [lo, (lo + hi) / 2, hi] };
}

/**
 * The language mistakes as a confusion matrix: rows (what it was) and columns (what was said)
 * both in the game's language order, so the table reads the same however the errors arrived.
 * A count is null where no one made that mistake; the diagonal is always null (right guesses aren't tallied).
 */
export function confusionMatrix(mistakenFor) {
  return {
    languages: LANGUAGES,
    counts: LANGUAGES.map((truth) => LANGUAGES.map((guess) => mistakenFor[truth]?.[guess] ?? null)),
  };
}
