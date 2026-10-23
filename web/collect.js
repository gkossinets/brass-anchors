// Sends game events to /api/log on the deployed site (see collect-core.js for when).
// Best-effort: a failed send never interrupts play, and games still save locally.
import { collectionEnabled, makeEvent } from "./collect-core.js";

// Earlier versions kept a lasting player id here; it linked one person's games.
const OLD_PLAYER_KEY = "brass-anchors.player";

// Decided once at boot: the mode links rewrite the URL and would drop ?collect=1.
export const collecting = collectionEnabled(location);

try {
  localStorage.removeItem(OLD_PLAYER_KEY);
} catch {
  // Storage blocked: there's nothing stored to remove either.
}

/**
 * Ids for a new game's events. Both are fresh random values for each game, so
 * nothing ties two games to the same person: the site collects no personal data.
 * (The player field stays in the event format; it now identifies nobody.)
 */
export function newGameIds() {
  return collecting ? { player: crypto.randomUUID(), game: crypto.randomUUID() } : null;
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
