// DOM helpers shared by both modes: one audio player, timbre memory, saved games, end screen.
import { initialTimbre } from "./quiz-core.js";
import { collecting, send } from "./collect.js";
import { startSpectrogram, clearSpectrogram } from "./visualizer.js";
import { roundSegments, splitScore } from "./display-core.js";
import { mediaErrorName, playRejection, clipOfSrc, createLoadTracker } from "./audio-core.js";

export { clearSpectrogram };
export const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "brass-anchors.games";
const TIMBRE_KEY = "brass-anchors.timbre";

// ---------- audio: one element, so starting any clip stops the others ----------

const audio = new Audio();
let current = null; // { button, label, status } of whatever is playing

// How long the round's first play took to start (ms), and where failures are reported.
// Each game resets the timing per round and sets the reporter for its own ids and mode.
let roundStartMs = null;
let reportFailure = null;

/** Forget the last round's start-up time; call when a round begins. */
export function resetAudioStart() {
  roundStartMs = null;
}

/** Milliseconds from Play to sound for this round's first play, or null if none started. */
export function audioStartMs() {
  return roundStartMs;
}

/** `report({clip_id, version, error, recovered, connection})` is called once per failed load. */
export function onAudioFailure(report) {
  reportFailure = report;
}

const LOAD_FAILED = "Couldn't load. Tap to try again";

/**
 * Play `src`, or stop it if it's already playing.
 *
 * `status(seconds, duration, playing)`, if given, is called as playback moves,
 * starts, and stops, so a screen can show "Playing · 0:07" or a timer.
 *
 * A clip that fails to load is retried once; the failure is reported either way.
 *
 * @returns {boolean} true if this call started playback (callers count plays on true).
 */
export function play(src, button, bar, label, canvas, status = null) {
  if (!audio.paused && audio.dataset.src === src) {
    audio.pause();
    return false;
  }
  if (current && current.button !== button) {
    current.button.textContent = current.label;
    current.status?.(audio.currentTime, audio.duration, false);
  }
  current = { button, label, status };
  audio.src = src;
  audio.dataset.src = src;
  audio.currentTime = 0;
  const pressed = performance.now();
  const tracker = createLoadTracker();
  const report = (playing) => status?.(audio.currentTime, audio.duration, playing);
  const send = (error, recovered) => {
    const clip = clipOfSrc(src);
    if (clip) reportFailure?.({ ...clip, error, recovered, connection: navigator.connection?.effectiveType ?? null });
  };
  // Stale events from a clip the player has since stopped or switched away from don't count.
  const isCurrent = () => audio.dataset.src === src && audio.hasAttribute("src");
  const failed = (error, attempt) => {
    if (!isCurrent()) return;
    const next = tracker.failed(error, attempt);
    if (next === "retry") {
      tracker.retrying();
      audio.load();
      start();
    } else if (next === "give-up") {
      send(error, false);
      button.textContent = LOAD_FAILED;
    }
  };
  // Each play() call's rejection belongs to the attempt that made it.
  const start = () => {
    const attempt = tracker.attempt();
    audio.play().catch((err) => {
      const kind = playRejection(err);
      if (kind === "failure") failed(err.name, attempt);
      else if (kind === "blocked" && isCurrent()) button.textContent = `Can't play: ${err.message}`;
    });
  };
  audio.ontimeupdate = () => {
    bar.style.width = `${100 * audio.currentTime / (audio.duration || 1)}%`;
    report(!audio.paused);
  };
  audio.onplay = () => { button.textContent = "Stop"; report(true); };
  audio.onplaying = () => {
    roundStartMs ??= Math.round(performance.now() - pressed);
    const recoveredFrom = tracker.started();
    if (recoveredFrom) send(recoveredFrom, true);
  };
  // A failure leaves the element paused; keep the failure message rather than the label.
  audio.onpause = audio.onended = () => { if (button.textContent !== LOAD_FAILED) button.textContent = label; report(false); };
  audio.onerror = () => {
    const error = mediaErrorName(audio.error?.code);
    if (error) failed(error, tracker.attempt());
  };
  startSpectrogram(canvas, audio);
  start();
  return true;
}

export function stopAudio() {
  audio.pause();
  audio.removeAttribute("src");
}

// ---------- screens ----------

export function show(name) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== `screen-${name}`;
  window.scrollTo(0, 0);
}

/**
 * The header bar's centre and right: on air (front page), off air (end), or a
 * game in progress with round segments and the running score.
 */
export function setHeader(state) {
  const progress = $("header-progress");
  const status = $("header-status");
  progress.innerHTML = "";
  progress.removeAttribute("aria-label");
  if (state.kind === "front" || state.kind === "end") {
    const on = state.kind === "front";
    status.innerHTML = `<span class="dot${on ? " live" : ""}"></span><span>${on ? `On air${state.span ? ` · ${state.span}` : ""}` : "Off air"}</span>`;
    return;
  }
  const { total, current, answered, score } = state;
  const label = `Round ${current} of ${total}`;
  const segments = roundSegments(total, current, answered);
  progress.setAttribute("aria-label", label);
  progress.innerHTML = segments
    ? segments.map((s) => `<span class="seg ${s}"></span>`).join("")
    : `<span class="meta">${label}</span>`;
  status.innerHTML = `<span>Score ${score}</span>`;
}

// ---------- timbre ----------

function rememberedTimbre() {
  try {
    return localStorage.getItem(TIMBRE_KEY);
  } catch {
    return null;
  }
}

export function rememberTimbre(id) {
  try {
    localStorage.setItem(TIMBRE_KEY, id);
  } catch {
    // Remembering the sound is a convenience; the game works without it.
  }
}

export function startingTimbre(timbres) {
  return initialTimbre(rememberedTimbre(), timbres);
}

/** Buttons for switching sound mid-round; `onSwitch(id)` runs after the choice is recorded. */
export function renderTimbreSwitch(box, timbres, chosen, onSwitch) {
  box.innerHTML = "";
  box.hidden = timbres.length < 2;
  for (const t of timbres) {
    const b = document.createElement("button");
    b.textContent = t.label;
    b.setAttribute("aria-pressed", String(t.id === chosen));
    b.onclick = () => {
      rememberTimbre(t.id);
      for (const sib of box.querySelectorAll("button")) sib.setAttribute("aria-pressed", String(sib === b));
      onSwitch(t.id);
    };
    box.append(b);
  }
}

// ---------- saved games ----------

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

function exportSaved() {
  const blob = new Blob([JSON.stringify(loadSaved(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `brass-anchors-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Show the end screen. `buildRecord(cues)` returns the game record to save;
 * saving twice replaces the first save rather than adding a duplicate. When
 * collecting, the record is sent as the game finishes (for the score
 * distribution) and again on Save with the notes; the stats keep the latest.
 * `mode` and `scorePct` let the results page mark where this game falls;
 * `meta` is the line under the score ("Match the clue · 5 rounds").
 */
export function showEnd({ score, tableHtml, buildRecord, ids, mode, scorePct, meta }) {
  stopAudio();
  send("game", ids, buildRecord(""));
  setHeader({ kind: "end" });
  $("see-results").href = `stats.html?mode=${mode}&you=${scorePct}`;
  const { got, max } = splitScore(score);
  $("final-score").innerHTML = max === null ? got : `${got}<span class="of"> / ${max}</span>`;
  $("end-meta").textContent = meta;
  $("summary-table").innerHTML = tableHtml;
  $("cues").value = "";
  $("save-status").textContent = "";
  let saved = false;
  $("save").onclick = () => {
    const games = loadSaved();
    const record = buildRecord($("cues").value.trim());
    if (saved) games[games.length - 1] = record;
    else games.push(record);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
      saved = true;
      $("save-status").textContent = `Saved. ${games.length} game${games.length === 1 ? "" : "s"} stored in this browser.` +
        (collecting ? " Your notes were also sent anonymously. Thank you!" : "");
    } catch (err) {
      $("save-status").textContent = `Could not save: ${err.message}. Use Export instead.`;
    }
    send("game", ids, record);
  };
  $("export").onclick = exportSaved;
  show("end");
}
