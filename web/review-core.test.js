import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTime, parseTime, sourceTime, changedFields, statusCounts } from "./review-core.js";

test("formatTime writes HH:MM:SS with tenths only when needed", () => {
  assert.equal(formatTime(62), "00:01:02");
  assert.equal(formatTime(62.54), "00:01:02.5");
  assert.equal(formatTime(3725.06), "01:02:05.1");
  assert.equal(formatTime(59.96), "00:01:00");
});

test("parseTime reads the same formats as the pipeline", () => {
  assert.equal(parseTime("00:01:02.5"), 62.5);
  assert.equal(parseTime("1:05"), 65);
  assert.equal(parseTime("12"), 12);
  assert.ok(Number.isNaN(parseTime("abc")));
});

test("a position in the context audio maps back to the source video", () => {
  assert.equal(sourceTime(55, 3.25), 58.3); // rounded to tenths
  assert.equal(sourceTime(0, 1.04), 1);
});

test("only fields whose values differ are sent", () => {
  const row = { speaker: "A", genre: "news", start: "00:01:00", notes: "" };
  const form = { speaker: "A", genre: "opinion", start: "00:01:00", notes: " " };
  assert.deepEqual(changedFields(row, form), { genre: "opinion" });
});

test("treats missing and empty review status as unreviewed when counting", () => {
  const clips = [{ review_status: "" }, { review_status: "approved" }, {}, { review_status: "rejected" }];
  assert.deepEqual(statusCounts(clips), { unreviewed: 2, approved: 1, needs_fix: 0, rejected: 1 });
});
