// Sends game events to /api/log on the deployed site (see collect-core.js for when).
// Best-effort: a failed send never interrupts play, and games still save locally.
import { collectionEnabled, makeEvent, deliver } from "./collect-core.js";

const PLAYER_KEY = "brass-anchors.player";

// Decided once at boot: the mode links rewrite the URL and would drop ?collect=1.
export const collecting = collectionEnabled(location);

let sessionPlayer = null;

// A random id that lets the stats count players without knowing who they are.
function playerId() {
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(PLAYER_KEY, id);
    }
    return id;
  } catch {
    sessionPlayer ??= crypto.randomUUID(); // storage blocked: one id for this page load
    return sessionPlayer;
  }
}

/** Ids for a new game's events. */
export function newGameIds() {
  return collecting ? { player: playerId(), game: crypto.randomUUID() } : null;
}

/** Send one event; does nothing when collection is off. */
export function send(kind, ids, record) {
  if (!collecting || !ids) return;
  try {
    const body = JSON.stringify(makeEvent(kind, ids, record));
    // While the page is being hidden or closed, only sendBeacon reliably gets out. Otherwise a
    // normal request, retried once: a beacon can't tell whether it arrived, and phones drop some.
    if (document.visibilityState === "hidden" &&
        navigator.sendBeacon?.("/api/log", new Blob([body], { type: "application/json" }))) return;
    const post = (b) => fetch("/api/log", { method: "POST", body: b, keepalive: true, headers: { "Content-Type": "application/json" } });
    deliver(post, body).then((arrived) => { if (!arrived) console.warn(`[collect] ${kind} event not stored`); });
  } catch (err) {
    console.warn(`[collect] ${err.message}`);
  }
}
