import { test } from "node:test";
import assert from "node:assert/strict";
import { formatClock, roundSegments, splitScore, MAX_SEGMENTS } from "./display-core.js";

test("formatClock shows m:ss, rounding down, and copes with unknown durations", () => {
  assert.equal(formatClock(7.9), "0:07");
  assert.equal(formatClock(74), "1:14");
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(NaN), "0:00");
  assert.equal(formatClock(Infinity), "0:00");
});

test("round segments: done, current, to come; a finished round counts as done", () => {
  assert.deepEqual(roundSegments(5, 3, false), ["done", "done", "current", "todo", "todo"]);
  assert.deepEqual(roundSegments(5, 3, true), ["done", "done", "done", "todo", "todo"]);
  assert.deepEqual(roundSegments(3, 1, false), ["current", "todo", "todo"]);
});

test("round segments fall back to text (null) when there are too many to draw", () => {
  assert.equal(roundSegments(MAX_SEGMENTS + 1, 1, false), null);
  assert.equal(roundSegments(MAX_SEGMENTS, 1, false).length, MAX_SEGMENTS);
});

test("splitScore separates the score from the maximum so the maximum can be muted", () => {
  assert.deepEqual(splitScore("7 / 9"), { got: "7", max: "9" });
  assert.deepEqual(splitScore("12 / 50"), { got: "12", max: "50" });
  assert.deepEqual(splitScore("odd"), { got: "odd", max: null });
});
