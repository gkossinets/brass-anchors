// Sends game events to /api/log on the deployed site (see collect-core.js for when).
// Best-effort: a failed send never interrupts play, and games still save locally.
import { collectionEnabled, makeEvent } from "./collect-core.js";

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
    // sendBeacon survives the tab closing right after the last answer.
    if (navigator.sendBeacon?.("/api/log", new Blob([body], { type: "application/json" }))) return;
    fetch("/api/log", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } })
      .catch((err) => console.warn(`[collect] ${err.message}`));
  } catch (err) {
    console.warn(`[collect] ${err.message}`);
  }
}
