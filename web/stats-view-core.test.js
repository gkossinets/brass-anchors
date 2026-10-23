import { test } from "node:test";
import assert from "node:assert/strict";
import { histogram, compareToOthers, clipLabel, pageParams, pct } from "./stats-view-core.js";

test("histogram: ten 10-point bins, with 100% in the top bin", () => {
  const bins = histogram([0, 9, 10, 55, 99, 100]);
  assert.equal(bins.length, 10);
  assert.deepEqual(bins.map((b) => b.count), [2, 1, 0, 0, 0, 1, 0, 0, 0, 2]);
  assert.deepEqual([bins[0].label, bins[9].label], ["0-9%", "90-100%"]);
  assert.deepEqual([bins[5].from, bins[5].to], [50, 59]);
});

test("compareToOthers leaves out your own game, then ranks you among the rest", () => {
  // Your 65 is in the list (your game was counted): compare with the other three.
  assert.deepEqual(compareToOthers([40, 65, 70, 90], 65), { others: 3, percentile: 33 });
  // Ties count half: equal to everyone else puts you at the 50th percentile.
  assert.deepEqual(compareToOthers([50, 50, 50], 50), { others: 2, percentile: 50 });
  assert.deepEqual(compareToOthers([10, 20, 30, 40, 55], 55), { others: 4, percentile: 100 });
});

test("compareToOthers: nobody else yet, or your game not counted yet", () => {
  assert.deepEqual(compareToOthers([65], 65), { others: 0, percentile: null });
  assert.deepEqual(compareToOthers([], 65), { others: 0, percentile: null });
  // Your game hasn't arrived yet: everyone in the list is someone else.
  assert.deepEqual(compareToOthers([40, 80], 65), { others: 2, percentile: 50 });
});

test("clip labels name the speaker, station, and year", () => {
  const byId = { a: { speaker: "Walter Cronkite", year: 1978, answer: { station: "CBS", decade: "1970s" } },
    b: { speaker: "Unknown presenter", year: null, answer: { station: "BBC", decade: "1990s" } } };
  assert.equal(clipLabel("a", byId), "Walter Cronkite (CBS, 1978)");
  assert.equal(clipLabel("b", byId), "Unknown presenter (BBC, 1990s)");
  assert.equal(clipLabel("gone", byId), "gone");
});

test("page params: mode defaults to match; your score only when it's a sensible number", () => {
  assert.deepEqual(pageParams(""), { mode: "match", you: null });
  assert.deepEqual(pageParams("?mode=classic&you=64"), { mode: "classic", you: 64 });
  assert.deepEqual(pageParams("?mode=karaoke&you=900"), { mode: "match", you: null });
  assert.deepEqual(pageParams("?you=abc"), { mode: "match", you: null });
});

test("pct rounds a share to a whole percentage", () => {
  assert.equal(pct(2, 3), "67%");
  assert.equal(pct(0, 0), "—");
});
