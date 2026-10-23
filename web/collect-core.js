// When to send game events to the server, and their shape (checked by server/collect-core.js).
// Pure (no DOM), so it runs under `node --test`.

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** On for the deployed site; off on a local dev server unless the URL says ?collect=1. */
export function collectionEnabled({ hostname, search }) {
  const forced = new URLSearchParams(search).get("collect");
  if (forced !== null) return forced === "1";
  return !LOCAL_HOSTS.includes(hostname);
}

/** An event for /api/log: a round as it's answered, or a whole game when the player saves it. */
export function makeEvent(kind, { player, game }, record) {
  return { kind, player, game, mode: record.mode, record };
}
