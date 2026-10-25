import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaErrorName, playRejection, clipOfSrc, createLoadTracker } from "./audio-core.js";

test("mediaErrorName names the load failures; an abort (the player moved on) is not one", () => {
  assert.equal(mediaErrorName(2), "network");
  assert.equal(mediaErrorName(3), "decode");
  assert.equal(mediaErrorName(4), "unsupported");
  assert.equal(mediaErrorName(1), null);
  assert.equal(mediaErrorName(undefined), null);
});

test("playRejection: a source that won't load is a failure; switching clips is not; autoplay rules are blocked", () => {
  assert.equal(playRejection({ name: "NotSupportedError" }), "failure");
  assert.equal(playRejection({ name: "AbortError" }), "ignore");
  assert.equal(playRejection({ name: "NotAllowedError" }), "blocked");
  assert.equal(playRejection({ name: "SomethingNew" }), "blocked");
});

test("clipOfSrc reads the clip and version from an audio path", () => {
  assert.deepEqual(clipOfSrc("audio/trombone/fr_masure_1994.mp3"), { clip_id: "fr_masure_1994", version: "trombone" });
  assert.deepEqual(clipOfSrc("https://brass-anchors.pages.dev/audio/original/us_a.mp3"), { clip_id: "us_a", version: "original" });
  assert.equal(clipOfSrc("elsewhere.mp3"), null);
});

test("load tracker: the first failure retries; a second gives up", () => {
  const t = createLoadTracker();
  assert.equal(t.failed("network"), "retry");
  t.retrying();
  assert.equal(t.failed("network"), "give-up");
  assert.equal(t.started(), null); // gave up: nothing to report on a later start
});

test("load tracker: the element's error and play()'s rejection for one attempt count once", () => {
  const t = createLoadTracker();
  assert.equal(t.failed("network"), "retry");
  t.retrying();
  assert.equal(t.failed("NotSupportedError"), "give-up");
  assert.equal(t.failed("network"), "ignore");
});

test("load tracker: a duplicate report before the retry starts is ignored", () => {
  const t = createLoadTracker();
  assert.equal(t.failed("network"), "retry");
  assert.equal(t.failed("NotSupportedError"), "ignore");
});

test("load tracker: a start after a retry reports the recovery once, with the first error", () => {
  const t = createLoadTracker();
  t.failed("decode");
  t.retrying();
  assert.equal(t.started(), "decode");
  assert.equal(t.started(), null);
});

test("load tracker: a clean start reports nothing", () => {
  assert.equal(createLoadTracker().started(), null);
});

test("load tracker: the first attempt's play() rejection arriving after the retry began is not the retry failing", () => {
  const t = createLoadTracker();
  const first = t.attempt();
  assert.equal(t.failed("network", first), "retry"); // the element's error event
  t.retrying();
  assert.equal(t.failed("NotSupportedError", first), "ignore"); // the first play()'s late rejection
  assert.equal(t.started(), "network"); // the retry played: a recovery
});
