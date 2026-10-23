import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BODY_BYTES, MAX_NOTES_CHARS, parseEvent } from "./collect-core.js";

const PLAYER = "0b6a0f4e-3c2d-4a7b-9f10-2a1c3d4e5f60";
const GAME = "9e8d7c6b-5a49-4382-a716-151413121110";

const round = (over = {}) => ({
  kind: "round", player: PLAYER, game: GAME, mode: "match",
  record: { format: 2, mode: "match", round: 3, clip_ids: ["a", "b"], ms_first_play_to_answer: 8123, right: true },
  ...over,
});
const game = (over = {}) => ({
  kind: "game", player: PLAYER, game: GAME, mode: "classic",
  record: { format: 2, mode: "classic", cues: "pauses gave it away", rounds: [] },
  ...over,
});
const body = (obj) => JSON.stringify(obj);

test("a round event becomes a row with its round number and the record as JSON", () => {
  const out = parseEvent(body(round()));
  assert.equal(out.ok, true);
  assert.deepEqual(
    { ...out.row, payload: JSON.parse(out.row.payload) },
    { kind: "round", player: PLAYER, game: GAME, mode: "match", round: 3, payload: round().record },
  );
});

test("a game event has no round number", () => {
  const out = parseEvent(body(game()));
  assert.equal(out.ok, true);
  assert.equal(out.row.round, null);
  assert.equal(JSON.parse(out.row.payload).cues, "pauses gave it away");
});

test("rejects bodies that are not a JSON object", () => {
  for (const bad of ["", "nope", "[]", "null", "42"]) assert.equal(parseEvent(bad).ok, false, bad);
});

test("rejects unknown kinds, modes, and malformed ids", () => {
  assert.equal(parseEvent(body(round({ kind: "spam" }))).ok, false);
  assert.equal(parseEvent(body(round({ mode: "karaoke" }))).ok, false);
  assert.equal(parseEvent(body(round({ player: "me" }))).ok, false);
  assert.equal(parseEvent(body(round({ game: "<script>" }))).ok, false);
  assert.equal(parseEvent(body(round({ record: "text" }))).ok, false);
});

test("a round record must carry a sensible round number that matches its mode", () => {
  const r = round();
  assert.equal(parseEvent(body({ ...r, record: { ...r.record, round: 0 } })).ok, false);
  assert.equal(parseEvent(body({ ...r, record: { ...r.record, round: 2.5 } })).ok, false);
  assert.equal(parseEvent(body({ ...r, record: { ...r.record, round: 101 } })).ok, false);
  assert.equal(parseEvent(body({ ...r, record: { ...r.record, mode: "classic" } })).ok, false);
});

test("caps the body size and the length of the notes", () => {
  const big = round({ record: { ...round().record, junk: "x".repeat(MAX_BODY_BYTES) } });
  assert.equal(parseEvent(body(big)).ok, false);
  const long = game({ record: { ...game().record, cues: "y".repeat(MAX_NOTES_CHARS + 1) } });
  assert.equal(parseEvent(body(long)).ok, false);
  const ok = game({ record: { ...game().record, cues: "y".repeat(MAX_NOTES_CHARS) } });
  assert.equal(parseEvent(body(ok)).ok, true);
});

test("the error says what was wrong, for the server log", () => {
  assert.match(parseEvent(body(round({ mode: "karaoke" }))).error, /mode/);
});
