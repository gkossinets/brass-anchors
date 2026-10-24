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

const RETRY_DELAY_MS = 2000;

/**
 * Post one event, retrying once after a network error or a server error (5xx). A 4xx means
 * the server rejected the event, and sending it again would be rejected again.
 * `post(body)` resolves to {ok, status} or throws; resolves to whether the event arrived.
 */
export async function deliver(post, body, { retries = 1, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await post(body);
      if (res.ok) return true;
      if (res.status < 500) return false;
    } catch {
      // network error: retry below
    }
    if (attempt >= retries) return false;
    await wait(RETRY_DELAY_MS);
  }
}
