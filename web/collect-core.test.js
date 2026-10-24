import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionEnabled, makeEvent, deliver } from "./collect-core.js";
import { parseEvent } from "../server/collect-core.js";

const loc = (hostname, search = "") => ({ hostname, search });

test("collects on the public site but not on a local dev server", () => {
  assert.equal(collectionEnabled(loc("brass-anchors.pages.dev")), true);
  assert.equal(collectionEnabled(loc("localhost")), false);
  assert.equal(collectionEnabled(loc("127.0.0.1")), false);
});

test("?collect=1 turns it on locally, for testing against `make site-dev`", () => {
  assert.equal(collectionEnabled(loc("localhost", "?collect=1")), true);
  assert.equal(collectionEnabled(loc("localhost", "?mode=match&collect=1")), true);
  assert.equal(collectionEnabled(loc("localhost", "?collect=0")), false);
});

test("events the game builds pass the server's checks", () => {
  const ids = { player: crypto.randomUUID(), game: crypto.randomUUID() };
  const round = makeEvent("round", ids, { format: 2, mode: "match", round: 1, right: false, points: 0,
    difficulty: "easy", correct_id: "a", distractor_id: "b", ms_first_play_to_answer: 5200 });
  assert.deepEqual(Object.keys(round).sort(), ["game", "kind", "mode", "player", "record"]);
  assert.equal(parseEvent(JSON.stringify(round)).ok, true);
  const game = makeEvent("game", ids, { format: 2, mode: "classic", cues: "", rounds: [] });
  assert.equal(parseEvent(JSON.stringify(game)).ok, true);
});

// ---------- delivery ----------

const poster = (...outcomes) => {
  const calls = [];
  const post = async (body) => {
    calls.push(body);
    const next = outcomes.shift();
    if (next instanceof Error) throw next;
    return { ok: next >= 200 && next < 300, status: next };
  };
  return { post, calls };
};
const noWait = () => Promise.resolve();

test("a delivered event is sent once", async () => {
  const { post, calls } = poster(204);
  assert.equal(await deliver(post, "{}", { wait: noWait }), true);
  assert.equal(calls.length, 1);
});

test("a network error or a server error is retried once", async () => {
  const net = poster(new Error("offline"), 204);
  assert.equal(await deliver(net.post, "{}", { wait: noWait }), true);
  assert.equal(net.calls.length, 2);
  const server = poster(503, 503);
  assert.equal(await deliver(server.post, "{}", { wait: noWait }), false);
  assert.equal(server.calls.length, 2);
});

test("an event the server rejects isn't retried: it would be rejected again", async () => {
  const { post, calls } = poster(400);
  assert.equal(await deliver(post, "{}", { wait: noWait }), false);
  assert.equal(calls.length, 1);
});
