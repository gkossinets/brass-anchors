import { test } from "node:test";
import assert from "node:assert/strict";
import { histogram, percentBelow, clipLabel, pageParams, pct } from "./stats-view-core.js";

test("histogram: ten 10-point bins, with 100% in the top bin", () => {
  const bins = histogram([0, 9, 10, 55, 99, 100]);
  assert.equal(bins.length, 10);
  assert.deepEqual(bins.map((b) => b.count), [2, 1, 0, 0, 0, 1, 0, 0, 0, 2]);
  assert.deepEqual([bins[0].label, bins[9].label], ["0-9%", "90-100%"]);
  assert.deepEqual([bins[5].from, bins[5].to], [50, 59]);
});

test("percentBelow: share of games that scored lower than you", () => {
  assert.equal(percentBelow([10, 20, 30, 40], 35), 75);
  assert.equal(percentBelow([10, 20, 30, 40], 10), 0);
  assert.equal(percentBelow([50, 50], 50), 0);
  assert.equal(percentBelow([], 50), null);
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
