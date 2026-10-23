// Checks one event sent by the game to /api/log and turns it into a database row.
// Pure (no Cloudflare APIs), so it runs under `node --test`.

// A game record with 50 rounds is about 15 KB; anything far bigger is not from the game.
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_NOTES_CHARS = 4000;
export const MAX_ROUNDS = 100;

const KINDS = ["round", "game"];
const MODES = ["classic", "match"];
// Player and game ids are crypto.randomUUID() values made in the browser.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const fail = (error) => ({ ok: false, error });
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Parse and check a request body.
 *
 * @returns {{ok: true, row: {kind, player, game, mode, round, payload}} | {ok: false, error: string}}
 */
export function parseEvent(text) {
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail(`body over ${MAX_BODY_BYTES} bytes`);
  let event;
  try {
    event = JSON.parse(text);
  } catch {
    return fail("body is not JSON");
  }
  if (!isObject(event)) return fail("body is not a JSON object");
  const { kind, player, game, mode, record } = event;
  if (!KINDS.includes(kind)) return fail(`unknown kind ${JSON.stringify(kind)}`);
  if (!MODES.includes(mode)) return fail(`unknown mode ${JSON.stringify(mode)}`);
  if (!UUID.test(player ?? "")) return fail("player id is not a UUID");
  if (!UUID.test(game ?? "")) return fail("game id is not a UUID");
  if (!isObject(record)) return fail("record is not an object");
  if (record.mode !== mode) return fail("record mode differs from event mode");

  let round = null;
  if (kind === "round") {
    round = record.round;
    if (!Number.isInteger(round) || round < 1 || round > MAX_ROUNDS) return fail("round number out of range");
  }
  if (typeof record.cues === "string" && record.cues.length > MAX_NOTES_CHARS) return fail("notes too long");

  return { ok: true, row: { kind, player, game, mode, round, payload: JSON.stringify(record) } };
}
