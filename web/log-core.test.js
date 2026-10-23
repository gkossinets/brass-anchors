import { test } from "node:test";
import assert from "node:assert/strict";
import { LOG_FORMAT, createPlayLog, roundRecord, modeFromSearch } from "./log-core.js";

test("play log counts plays per clip and times from the first play", () => {
  let now = 1000;
  const log = createPlayLog(() => now);
  assert.equal(log.allPlayed(["a", "b"]), false);
  log.played("a");
  now = 1500;
  log.played("a");
  assert.equal(log.allPlayed(["a", "b"]), false);
  now = 4000;
  log.played("b");
  assert.equal(log.allPlayed(["a", "b"]), true);
  now = 9000;
  assert.deepEqual(log.counts(), { a: 2, b: 1 });
  assert.equal(log.msSinceFirstPlay(), 8000);
});

test("time to answer is null if nothing was played", () => {
  assert.equal(createPlayLog(() => 5).msSinceFirstPlay(), null);
});

test("round records share one shape across modes", () => {
  const shared = { round: 2, clipIds: ["a", "b"], plays: { a: 1, b: 2 }, msToAnswer: 3200, timbre: "trombone" };
  const match = roundRecord("match", shared, { difficulty: "hard", right: true });
  const classic = roundRecord("classic", { ...shared, clipIds: ["a"] }, { guess: { decade: "1970s" } });
  for (const r of [match, classic]) {
    assert.deepEqual(Object.keys(r).slice(0, 7), ["format", "mode", "round", "clip_ids", "plays", "ms_first_play_to_answer", "timbre"]);
    assert.equal(r.format, LOG_FORMAT);
  }
  assert.equal(match.mode, "match");
  assert.equal(match.difficulty, "hard");
  assert.deepEqual(classic.clip_ids, ["a"]);
});

test("the mode comes only from the URL: classic, match, or none for the front page", () => {
  assert.equal(modeFromSearch("?mode=match"), "match");
  assert.equal(modeFromSearch("?mode=classic"), "classic");
  assert.equal(modeFromSearch("?mode=MATCH"), "match");
  assert.equal(modeFromSearch(""), null);
  assert.equal(modeFromSearch("?mode=bogus"), null);
  assert.equal(modeFromSearch("?other=1&mode=match"), "match");
});
