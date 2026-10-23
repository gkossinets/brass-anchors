import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_MESSAGE_CHARS, parseFeedback, formatFeedback } from "./feedback-core.js";

const body = (obj) => JSON.stringify(obj);

test("a message from a known page becomes a row, trimmed", () => {
  const out = parseFeedback(body({ message: "  Add more 1970s clips!  ", page: "front" }));
  assert.deepEqual(out, { ok: true, spam: false, row: { page: "front", message: "Add more 1970s clips!" } });
});

test("empty, oversized, or non-JSON messages are rejected with a reason", () => {
  assert.equal(parseFeedback(body({ message: "   ", page: "front" })).ok, false);
  assert.equal(parseFeedback(body({ message: "x".repeat(MAX_MESSAGE_CHARS + 1), page: "front" })).ok, false);
  assert.equal(parseFeedback(body({ message: 42, page: "front" })).ok, false);
  assert.equal(parseFeedback("not json").ok, false);
  assert.match(parseFeedback(body({ message: "", page: "front" })).error, /empty/);
});

test("the page must be one the site has; anything else is recorded as other", () => {
  assert.equal(parseFeedback(body({ message: "hi", page: "results" })).row.page, "results");
  assert.equal(parseFeedback(body({ message: "hi", page: "<script>" })).row.page, "other");
});

test("a filled-in hidden field marks a bot: accepted (so it doesn't retry) but not stored", () => {
  const out = parseFeedback(body({ message: "cheap pills", page: "front", website: "http://spam.example" }));
  assert.deepEqual(out, { ok: true, spam: true });
});

test("formatFeedback lists messages oldest first with time and page", () => {
  const text = formatFeedback([
    { received_at: "2026-10-23T15:00:00.000Z", page: "results", message: "Love the chart" },
    { received_at: "2026-10-23T14:00:00.000Z", page: "front", message: "More clips\nplease" },
  ]);
  assert.equal(text, "2026-10-23 14:00  front    More clips please\n2026-10-23 15:00  results  Love the chart");
  assert.equal(formatFeedback([]), "No feedback yet.");
});
