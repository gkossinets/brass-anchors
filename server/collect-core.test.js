import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BODY_BYTES, MAX_NOTES_CHARS, parseEvent } from "./collect-core.js";

const PLAYER = "0b6a0f4e-3c2d-4a7b-9f10-2a1c3d4e5f60";
const GAME = "9e8d7c6b-5a49-4382-a716-151413121110";

const round = (over = {}) => ({
  kind: "round", player: PLAYER, game: GAME, mode: "match",
  record: { format: 2, mode: "match", round: 3, clip_ids: ["a", "b"], ms_first_play_to_answer: 8123, right: true,
    difficulty: "hard", points: 3, correct_id: "a", distractor_id: "b" },
  ...over,
});
test("match rounds from format 3 on score one point; format 2 rounds keep their multiplier", () => {
  const flat = (record) => parseEvent(body(round({ record: { ...round().record, ...record } }))).ok;
  assert.equal(flat({ format: 3, points: 1 }), true);
  assert.equal(flat({ format: 3, points: 3 }), false);
  assert.equal(flat({ format: 3, right: false, points: 0 }), true);
  assert.equal(flat({ format: 2, points: 3 }), true, "games logged before the change still count");
  assert.equal(flat({ format: 2, points: 1 }), false);
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

test("a match round must look like one the game sends", () => {
  const r = round();
  const withRecord = (over) => body({ ...r, record: { ...r.record, ...over } });
  assert.equal(parseEvent(withRecord({ difficulty: "trivial" })).ok, false);
  assert.equal(parseEvent(withRecord({ right: "yes" })).ok, false);
  assert.equal(parseEvent(withRecord({ points: 99 })).ok, false);
  assert.equal(parseEvent(withRecord({ correct_id: "" })).ok, false);
  assert.equal(parseEvent(withRecord({ correct_id: "x".repeat(200) })).ok, false);
});

test("answer times must be humanly possible: both clips started, at least a second", () => {
  const r = round();
  const withMs = (ms) => body({ ...r, record: { ...r.record, ms_first_play_to_answer: ms } });
  assert.equal(parseEvent(withMs(150)).ok, false);
  assert.equal(parseEvent(withMs(null)).ok, false);
  assert.equal(parseEvent(withMs(4 * 3600 * 1000)).ok, false);
  assert.equal(parseEvent(withMs(1000)).ok, true);
});

test("a classic round may have no play time (answered before pressing Play) but not an impossible one", () => {
  const classic = { kind: "round", player: PLAYER, game: GAME, mode: "classic",
    record: { mode: "classic", round: 1, clip_id: "a", guess: {}, score: { total: 2 }, ms_first_play_to_answer: null } };
  assert.equal(parseEvent(body(classic)).ok, true);
  assert.equal(parseEvent(body({ ...classic, record: { ...classic.record, ms_first_play_to_answer: 10 } })).ok, false);
  assert.equal(parseEvent(body({ ...classic, record: { ...classic.record, score: { total: 50 } } })).ok, false);
});

test("difficulty must be a real level, not an inherited property name", () => {
  const r = round();
  assert.equal(parseEvent(body({ ...r, record: { ...r.record, difficulty: "constructor", points: 0, right: false } })).ok, false);
});

const languageRound = (over = {}) => ({ kind: "round", player: PLAYER, game: GAME, mode: "language",
  record: { mode: "language", round: 1, clip_id: "fr_1970s_ortf_x", language: "fr", guess: { language: "fr" },
    score: { language: 1, total: 1 }, ms_first_play_to_answer: 4000, ...over } });

test("a language round is accepted when its point follows from the guess and the answer", () => {
  assert.equal(parseEvent(body(languageRound())).ok, true);
  assert.equal(parseEvent(body(languageRound({ guess: { language: "ru" }, score: { language: 0, total: 0 } }))).ok, true);
});

test("a language round can't claim a point for a wrong guess, or name a language the game doesn't have", () => {
  assert.equal(parseEvent(body(languageRound({ guess: { language: "ru" } }))).ok, false);
  assert.equal(parseEvent(body(languageRound({ score: { language: 0, total: 0 } }))).ok, false);
  assert.equal(parseEvent(body(languageRound({ language: "de", guess: { language: "de" } }))).ok, false);
  assert.equal(parseEvent(body(languageRound({ guess: {} , score: { total: 0 } }))).ok, false);
  assert.equal(parseEvent(body(languageRound({ ms_first_play_to_answer: 10 }))).ok, false);
});

test("clip ids can't be names every object inherits: one such row used to break both stats pages", () => {
  for (const id of ["__proto__", "constructor", "prototype"]) {
    assert.equal(parseEvent(body(languageRound({ clip_id: id }))).ok, false, id);
  }
  assert.equal(parseEvent(body(languageRound({ clip_id: "fr_1970s_ortf_x" }))).ok, true);
});

const audio = (over = {}) => ({
  kind: "audio", player: PLAYER, game: GAME, mode: "classic",
  record: { mode: "classic", round: 4, clip_id: "us_a", version: "trombone", error: "network", recovered: false, connection: "4g" },
  ...over,
});
const audioOk = (record) => parseEvent(body(audio({ record: { ...audio().record, ...record } }))).ok;

test("an audio failure becomes a row with its round number", () => {
  const out = parseEvent(body(audio()));
  assert.equal(out.ok, true);
  assert.equal(out.row.kind, "audio");
  assert.equal(out.row.round, 4);
});

test("an audio failure must name a real clip version, error, and outcome", () => {
  assert.equal(audioOk({ version: "hum" }), true);
  assert.equal(audioOk({ version: "original", recovered: true, connection: null }), true);
  assert.equal(audioOk({ error: "NotSupportedError" }), true, "a play() rejection carries the DOMException name");
  assert.equal(audioOk({ version: "kazoo" }), false);
  assert.equal(audioOk({ clip_id: "__proto__" }), false);
  assert.equal(audioOk({ error: "x".repeat(41) }), false);
  assert.equal(audioOk({ error: "<script>" }), false);
  assert.equal(audioOk({ recovered: "yes" }), false);
  assert.equal(audioOk({ connection: "fiber-to-the-moon" }), false);
  assert.equal(audioOk({ round: 0 }), false);
});

test("a round may say how long its first play took to start, within reason", () => {
  const withStart = (ms) => parseEvent(body(round({ record: { ...round().record, format: 3, points: 1, ms_audio_start: ms } }))).ok;
  assert.equal(withStart(240), true);
  assert.equal(withStart(0), true);
  assert.equal(withStart(null), true, "no play started");
  assert.equal(withStart(-5), false);
  assert.equal(withStart(10 * 60 * 1000 + 1), false);
  assert.equal(withStart("fast"), false);
});
