// DOM helpers shared by both modes: one audio player, timbre memory, saved games, end screen.
import { initialTimbre } from "./quiz-core.js";
import { collecting, send } from "./collect.js";
import { startSpectrogram, clearSpectrogram } from "./visualizer.js";

export { clearSpectrogram };
export const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "brass-anchors.games";
const TIMBRE_KEY = "brass-anchors.timbre";

// ---------- audio: one element, so starting any clip stops the others ----------

const audio = new Audio();
let current = null; // { button, label } of whatever is playing

/**
 * Play `src`, or stop it if it's already playing.
 *
 * @returns {boolean} true if this call started playback (callers count plays on true).
 */
export function play(src, button, bar, label, canvas) {
  if (!audio.paused && audio.dataset.src === src) {
    audio.pause();
    return false;
  }
  if (current && current.button !== button) current.button.textContent = current.label;
  current = { button, label };
  audio.src = src;
  audio.dataset.src = src;
  audio.currentTime = 0;
  audio.ontimeupdate = () => { bar.style.width = `${100 * audio.currentTime / (audio.duration || 1)}%`; };
  audio.onplay = () => { button.textContent = "Stop"; };
  audio.onpause = audio.onended = () => { button.textContent = label; };
  startSpectrogram(canvas, audio);
  audio.play().catch((err) => { button.textContent = `Can't play: ${err.message}`; });
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
    b.classList.toggle("chosen", t.id === chosen);
    b.onclick = () => {
      rememberTimbre(t.id);
      for (const sib of box.querySelectorAll("button")) sib.classList.toggle("chosen", sib === b);
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
 * `mode` and `scorePct` let the results page mark where this game falls.
 */
export function showEnd({ score, tableHtml, buildRecord, ids, mode, scorePct }) {
  stopAudio();
  send("game", ids, buildRecord(""));
  $("see-results").href = `stats.html?mode=${mode}&you=${scorePct}`;
  $("final-score").textContent = score;
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
