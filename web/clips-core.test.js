import { test } from "node:test";
import assert from "node:assert/strict";
import { MEASURES, measuresFor, parseBy, groupOf, groupOrder, groupRows, standouts, axis, chartCaption, formatValue, confusionMatrix } from "./clips-core.js";

const clip = (id, language, country, decade, sex, stats) =>
  ({ id, speaker: id.toUpperCase(), sex, year: 2000, answer: { language, country, decade }, stats });
const s = (hz, range, sd, pauses, pause, silent) =>
  ({ median_hz: hz, range_st: range, sd_st: sd, pauses_per_min: pauses, mean_pause_s: pause, pause_pct: silent });

const CLIPS = [
  clip("uk1", "en", "UK", "1960s", "m", s(120, 10, 3, 10, 0.3, 5)),
  clip("uk2", "en", "UK", "1960s", "m", s(140, 14, 4, 20, 0.5, 15)),
  clip("fr1", "fr", "France", "2000s", "f", s(200, 8, 2, 6, 0.2, 2)),
  clip("fr2", "fr", "France", "2000s", "m", s(130, 12, 3, 30, 0.4, 20)),
  clip("fr3", "fr", "France", "2000s", "f", s(220, 9, 2.5, 8, 0.25, 4)),
  clip("fr4", "fr", "France", "2000s", "f", null),
];

test("?by= picks the grouping; anything else means language", () => {
  assert.equal(parseBy("?by=decade"), "decade");
  assert.equal(parseBy("?by=sex"), "sex");
  assert.equal(parseBy("?by=bogus"), "language");
  assert.equal(parseBy(""), "language");
});

test("English splits by country; other groupings use decade and sex", () => {
  assert.equal(groupOf(CLIPS[0], "language"), "English UK");
  assert.equal(groupOf(CLIPS[2], "language"), "French");
  assert.equal(groupOf(CLIPS[2], "decade"), "2000s");
  assert.equal(groupOf(CLIPS[2], "sex"), "Women");
  assert.equal(groupOf(CLIPS[0], "sex"), "Men");
});

test("groups come in a fixed order: languages as listed, decades ascending, women then men", () => {
  assert.deepEqual(groupOrder(CLIPS, "language"), ["English UK", "French"]);
  assert.deepEqual(groupOrder([...CLIPS].reverse(), "decade"), ["1960s", "2000s"]);
  assert.deepEqual(groupOrder(CLIPS, "sex"), ["Women", "Men"]);
});

test("group medians: pitch per sex, null where a group has no one of that sex", () => {
  const [uk, fr] = groupRows(CLIPS, "language");
  assert.equal(uk.group, "English UK");
  assert.equal(uk.medians.pitch_f, null);
  assert.equal(uk.medians.pitch_m, 130);
  assert.equal(fr.medians.pitch_f, 210);
  assert.equal(fr.medians.pitch_m, 130);
  assert.equal(fr.medians.range, 9);
});

test("a clip without stats counts toward the group size but not its medians", () => {
  const fr = groupRows(CLIPS, "language")[1];
  assert.equal(fr.n, 4);
  assert.equal(fr.medians.pauses, 8);
});

test("grouped by sex, the two pitch measures become one", () => {
  const ids = measuresFor("sex").map((m) => m.id);
  assert.ok(ids.includes("pitch") && !ids.includes("pitch_f") && !ids.includes("pitch_m"));
  const [women, men] = groupRows(CLIPS, "sex");
  assert.deepEqual([women.group, women.medians.pitch, men.group, men.medians.pitch], ["Women", 210, "Men", 130]);
  assert.ok(measuresFor("language").some((m) => m.id === "pitch_f"));
});

test("pitch variation is charted but not in the table", () => {
  const variation = MEASURES.find((m) => m.id === "variation");
  assert.equal(variation.key, "sd_st");
  assert.equal(variation.inTable, false);
});

test("standouts name the extremes over every clip", () => {
  const byLabel = Object.fromEntries(standouts(CLIPS).map((x) => [x.label, [x.clip.id, x.value]]));
  assert.deepEqual(byLabel["Widest pitch range"], ["uk2", 14]);
  assert.deepEqual(byLabel["Narrowest pitch range"], ["fr1", 8]);
  assert.deepEqual(byLabel["Most pauses"], ["fr2", 30]);
  assert.deepEqual(byLabel["Fewest pauses"], ["fr1", 6]);
  assert.deepEqual(byLabel["Most time silent"], ["fr2", 20]);
  assert.deepEqual(byLabel["Longest pauses"], ["uk2", 0.5]);
});

test("axis leaves room on both sides and has three ticks at its ends and middle", () => {
  const a = axis([7.5, 20.1]);
  assert.ok(a.lo < 7.5 && a.hi > 20.1);
  assert.equal(a.ticks.length, 3);
  assert.deepEqual([a.ticks[0], a.ticks[2]], [a.lo, a.hi]);
  const b = axis([4, 37]);
  assert.ok(b.lo < 4 && b.hi > 37 && b.lo >= 0);
});

test("a chart's caption names the highest and lowest group, skipping groups with no value", () => {
  const rows = groupRows(CLIPS, "language");
  const range = MEASURES.find((m) => m.id === "range");
  assert.equal(chartCaption(rows, range), "Highest: English UK, 12.0 st. Lowest: French, 9.0 st.");
  const women = MEASURES.find((m) => m.id === "pitch_f");
  assert.equal(chartCaption(rows, women), "Only French has a value.");
  assert.equal(chartCaption([], range), "");
});

test("values are formatted with the measure's digits and unit", () => {
  assert.equal(formatValue(0.4, MEASURES.find((m) => m.id === "pause_len")), "0.40 s");
  assert.equal(formatValue(null, MEASURES[0]), "—");
});

test("the guesses table is square, in the game's language order, with right guesses on the diagonal", () => {
  const m = confusionMatrix({ zh: { ru: 2, zh: 5 }, fr: { zh: 1, en: 3, fr: 7 } });
  assert.deepEqual(m.languages, ["en", "fr", "ru", "zh"]);
  assert.deepEqual(m.counts, [
    [null, null, null, null],
    [3, 7, null, 1],
    [null, null, null, null],
    [null, null, 2, 5],
  ]);
});
