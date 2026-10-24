// "Match the description" screens. Rules live in match-core.js.
import { displayAnswer } from "./quiz-core.js";
import { MATCH_CONFIG, buildMatchGame, findPhrase, scoreMatch, summarizeMatch } from "./match-core.js";
import { geeksHtml } from "./geeks.js";
import { LOG_FORMAT, createPlayLog, roundRecord } from "./log-core.js";
import { $, play, stopAudio, show, clearSpectrogram, renderTimbreSwitch, showEnd, setHeader } from "./shared.js";
import { formatClock } from "./display-core.js";
import { newGameIds, send } from "./collect.js";

const SIDES = ["A", "B"];
let timbres = [];
let game = null;

const escape = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

// The text after the FIND tag in the caption bar.
function promptHtml(clip) {
  return escape(findPhrase(clip));
}

const runningScore = () => game.results.reduce((sum, r) => sum + r.points, 0);

function header(answered) {
  setHeader({ kind: "game", total: game.rounds.length, current: game.index + 1, answered, score: runningScore() });
}

function clipOn(round, side) {
  return side === round.correctSide ? round.correct : round.distractor;
}

export function startMatch(corpus, timbreList, settings) {
  timbres = timbreList;
  const built = buildMatchGame(corpus, { rounds: settings.rounds });
  // Fallbacks are part of the game record too; the console note helps while curating.
  for (const note of built.fallbacks) console.info(`[match] ${note}`);
  game = {
    settings,
    timbre: settings.timbre,
    rounds: built.rounds,
    fallbacks: built.fallbacks,
    index: 0,
    results: [],
    records: [],
    started: new Date().toISOString(),
    ids: newGameIds(),
  };
  if (game.rounds.length === 0) {
    $("match-prompt").textContent = "Not enough clips for this game.";
    show("match");
    return;
  }
  showRound();
}

// ---------- round ----------

function cardHtml(side) {
  return `<div class="card clip-card" data-side="${side}">
    <div class="card-head"><span class="side">Clip ${side}</span><span class="clip-status meta"></span></div>
    <div class="well"><div class="spectro"><canvas aria-label="Spectrogram of clip ${side}"></canvas></div></div>
    <div class="progress"><div></div></div>
    <div class="card-actions">
      <button class="play secondary">Play</button>
      <button class="pick secondary brass" disabled aria-label="This one: clip ${side}">This one</button>
    </div>
  </div>`;
}

// "● Playing · 0:07" while it plays, "Played · 0:14" once it has stopped.
function cardStatus(card) {
  const el = card.querySelector(".clip-status");
  return (seconds, duration, playing) => {
    card.classList.toggle("playing", playing);
    el.classList.toggle("live", playing);
    el.textContent = playing ? `● Playing · ${formatClock(seconds)}` : `Played · ${formatClock(duration)}`;
  };
}

function showRound() {
  stopAudio();
  const round = game.rounds[game.index];
  const plays = createPlayLog();
  const heard = new Set();
  const ids = SIDES.map((s) => clipOn(round, s).id);

  $("match-label").textContent = `Round ${game.index + 1} of ${game.rounds.length}`;
  header(false);
  $("match-prompt").innerHTML = promptHtml(round.correct);
  const box = $("match-cards");
  box.innerHTML = SIDES.map(cardHtml).join("");
  $("match-hint").hidden = false;

  for (const card of box.querySelectorAll(".card")) {
    const side = card.dataset.side;
    const clip = clipOn(round, side);
    const button = card.querySelector(".play");
    button.onclick = () => {
      if (!play(clip.audio[game.timbre], button, card.querySelector(".progress > div"), "Play", card.querySelector("canvas"), cardStatus(card))) return;
      plays.played(clip.id);
      heard.add(game.timbre);
      // Both clips must have been started before a pick counts: no blind guessing.
      if (plays.allPlayed(ids)) {
        for (const pick of box.querySelectorAll(".pick")) pick.disabled = false;
        $("match-hint").hidden = true;
      }
    };
    card.querySelector(".pick").onclick = () => pick(side, round, plays, heard);
  }
  renderTimbreSwitch($("match-timbre-switch"), timbres, game.timbre, (id) => {
    game.timbre = id;
    stopAudio(); // both clips switch together; the player presses Play again to hear the new sound
  });
  show("match");
  for (const canvas of box.querySelectorAll("canvas")) clearSpectrogram(canvas);
}

function pick(side, round, plays, heard) {
  const msToAnswer = plays.msSinceFirstPlay();
  stopAudio();
  const { right, points } = scoreMatch(round, side);
  game.results.push({ level: round.level, differs: round.differs, right, points });
  const record = roundRecord("match", {
    round: game.index + 1,
    clipIds: SIDES.map((s) => clipOn(round, s).id),
    plays: plays.counts(),
    msToAnswer,
    timbre: game.timbre,
  }, {
    difficulty: round.level,
    requested_difficulty: round.requestedLevel,
    differs: round.differs,
    decade_gap: round.decadeGap,
    correct_id: round.correct.id,
    distractor_id: round.distractor.id,
    correct_side: round.correctSide,
    pick: side,
    right,
    points,
    timbres_heard: [...heard],
  });
  game.records.push(record);
  send("round", game.ids, record);
  showReveal(round, side, right, points);
}

// ---------- reveal ----------

// Exactly 6 children: the reveal cards share a subgrid, one row per section (see style.css).
function revealCardHtml(round, side, picked) {
  const clip = clipOn(round, side);
  const matches = side === round.correctSide;
  const facts = [
    ["Country", "country", clip.answer.country],
    ["Year", "decade", clip.year ?? clip.answer.decade],
    ["News or opinion", "genre", displayAnswer("genre", clip.answer.genre)],
  ];
  // One row of three values under small labels: a third of the height of three stacked rows.
  const rows = `<thead><tr>${facts.map(([label]) => `<th scope="col">${label}</th>`).join("")}</tr></thead>` +
    `<tbody><tr>${facts.map(([, key, value]) => {
      const differs = round.differs.includes(key) && !matches;
      return `<td class="${differs ? "bad" : ""}">${differs ? "✕ " : ""}${escape(value)}</td>`;
    }).join("")}</tr></tbody>`;
  return `<div class="card ${matches ? "is-match" : "not-match"}" data-side="${side}">
    <div class="card-head">
      <span class="side">Clip ${side}</span>
      <span class="verdict ${matches ? "good" : "bad"}">${matches ? "Matches" : "Doesn't match"}</span>
      ${picked ? '<span class="chip">Your pick</span>' : ""}
    </div>
    <div class="who-row">
      ${clip.thumbnail ? `<img class="thumb" src="${clip.thumbnail}" alt="${escape(clip.speaker)}">` : '<span class="thumb"></span>'}
      <div><p class="who">${escape(clip.speaker)}</p><p class="who-meta">${escape(clip.program)} (${escape(clip.answer.station)})</p></div>
    </div>
    <table class="facts">${rows}</table>
    ${geeksHtml(clip)}
    <div class="well"><div class="spectro"><canvas aria-label="Spectrogram of the original ${side}"></canvas></div></div>
    <div class="card-actions">
      <button class="play secondary">Hear the original</button>
      <div class="progress"><div></div></div>
      <a href="${clip.link}" target="_blank" rel="noopener">Source on YouTube</a>
    </div>
  </div>`;
}

function showReveal(round, picked, right, points) {
  $("match-reveal-label").textContent = `Round ${game.index + 1} of ${game.rounds.length}`;
  // "Correct", not "Right": the two clips sit left and right.
  $("match-result").textContent = right ? "Correct" : "Not this time";
  $("match-result").className = `result-tag ${right ? "right" : "wrong"}`;
  header(true);
  $("match-reveal-prompt").innerHTML = promptHtml(round.correct);
  const box = $("match-reveal-cards");
  box.innerHTML = SIDES.map((s) => revealCardHtml(round, s, s === picked)).join("");
  for (const card of box.querySelectorAll(".card")) {
    const clip = clipOn(round, card.dataset.side);
    const button = card.querySelector(".play");
    button.onclick = () =>
      play(clip.audio.original, button, card.querySelector(".progress > div"), "Hear the original", card.querySelector("canvas"));
  }
  game.index += 1;
  $("match-next").textContent = game.index < game.rounds.length ? "Next" : "Finish";
  $("match-next").onclick = () => (game.index < game.rounds.length ? showRound() : finish());
  show("match-reveal");
  // Enter or Space moves on; preventScroll keeps the page at the top.
  $("match-next").focus({ preventScroll: true });
  for (const canvas of box.querySelectorAll("canvas")) clearSpectrogram(canvas);
}

// ---------- end ----------

function finish() {
  const s = summarizeMatch(game.results);
  // The closest pairs, where the clips differed in one thing only, are the telling ones.
  const closeRows = Object.entries(s.hardByAttribute).map(([attr, r]) =>
    `<tr><td>When only ${MATCH_CONFIG.attributeLabel[attr]} differed</td><td class="pts">${r.right} / ${r.total}</td></tr>`).join("");
  showEnd({
    score: `${s.total} / ${s.max}`,
    ids: game.ids,
    mode: "match",
    scorePct: Math.round((100 * s.total) / s.max),
    meta: `Match the description · ${game.results.length} round${game.results.length === 1 ? "" : "s"}`,
    tableHtml: closeRows ? `<tr><th>Closest pairs</th><th></th></tr>${closeRows}` : "",
    buildRecord: (cues) => ({
      format: LOG_FORMAT,
      mode: "match",
      started: game.started,
      finished: new Date().toISOString(),
      settings: { rounds: game.settings.rounds, timbre_at_start: game.settings.timbre },
      fallbacks: game.fallbacks,
      summary: s,
      rounds: game.records,
      cues,
    }),
  });
}
