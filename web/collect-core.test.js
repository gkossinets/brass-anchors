import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionEnabled, makeEvent } from "./collect-core.js";
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
  const round = makeEvent("round", ids, { format: 2, mode: "match", round: 1, right: false });
  assert.deepEqual(Object.keys(round).sort(), ["game", "kind", "mode", "player", "record"]);
  assert.equal(parseEvent(JSON.stringify(round)).ok, true);
  const game = makeEvent("game", ids, { format: 2, mode: "classic", cues: "", rounds: [] });
  assert.equal(parseEvent(JSON.stringify(game)).ok, true);
});
