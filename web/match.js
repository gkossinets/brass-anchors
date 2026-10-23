// "Match the description" screens. Rules live in match-core.js.
import { displayAnswer } from "./quiz-core.js";
import { MATCH_CONFIG, buildMatchGame, describe, scoreMatch, summarizeMatch, LEVELS, geekStatsRows } from "./match-core.js";
import { LOG_FORMAT, createPlayLog, roundRecord } from "./log-core.js";
import { $, play, stopAudio, show, clearSpectrogram, renderTimbreSwitch, showEnd } from "./shared.js";
import { newGameIds, send } from "./collect.js";

const SIDES = ["A", "B"];
let timbres = [];
let game = null;

const escape = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

function promptHtml(clip) {
  const d = describe(clip);
  return `Which of these is a <strong>${escape(d.country)} ${escape(d.genre)}</strong> from the <strong>${escape(d.decade)}</strong>?`;
}

function clipOn(round, side) {
  return side === round.correctSide ? round.correct : round.distractor;
}

export function startMatch(corpus, timbreList, settings) {
  timbres = timbreList;
  const built = buildMatchGame(corpus, { rounds: settings.rounds, pure: settings.pure });
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
    $("match-prompt").textContent = "Not enough clips for this game. Try turning off pure mode.";
    show("match");
    return;
  }
  showRound();
}

// ---------- round ----------

function cardHtml(side) {
  return `<div class="card" data-side="${side}">
    <div class="card-head"><span class="side">${side}</span></div>
    <div class="player"><button class="play primary">Play</button><div class="progress"><div></div></div></div>
    <div class="spectro"><canvas aria-label="Spectrogram of clip ${side}"></canvas></div>
    <button class="pick" disabled>This one is ${side}</button>
  </div>`;
}

function showRound() {
  stopAudio();
  const round = game.rounds[game.index];
  const plays = createPlayLog();
  const heard = new Set();
  const ids = SIDES.map((s) => clipOn(round, s).id);

  $("match-label").textContent = `Round ${game.index + 1} of ${game.rounds.length} · ${round.level}`;
  $("match-prompt").innerHTML = promptHtml(round.correct);
  const box = $("match-cards");
  box.innerHTML = SIDES.map(cardHtml).join("");
  $("match-hint").hidden = false;

  for (const card of box.querySelectorAll(".card")) {
    const side = card.dataset.side;
    const clip = clipOn(round, side);
    const button = card.querySelector(".play");
    button.onclick = () => {
      if (!play(clip.audio[game.timbre], button, card.querySelector(".progress > div"), "Play", card.querySelector("canvas"))) return;
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

function revealCardHtml(round, side, picked) {
  const clip = clipOn(round, side);
  const matches = side === round.correctSide;
  const rows = [
    ["Country", "country", clip.answer.country],
    ["Year", "decade", clip.year ?? clip.answer.decade],
    ["News or opinion", "genre", displayAnswer("genre", clip.answer.genre)],
  ].map(([label, key, value]) => {
    const differs = round.differs.includes(key) && !matches;
    return `<tr><td>${label}</td><td class="${differs ? "bad" : ""}">${escape(value)}</td></tr>`;
  }).join("");
  return `<div class="card ${matches ? "is-match" : "not-match"}" data-side="${side}">
    <div class="card-head">
      <span class="side">${side}</span>
      <span class="${matches ? "good" : "bad"}">${matches ? "Matches" : "Doesn't match"}</span>
      ${picked ? '<span class="muted">your pick</span>' : ""}
    </div>
    <div class="who-row">
      ${clip.thumbnail ? `<img class="thumb" src="${clip.thumbnail}" alt="${escape(clip.speaker)}">` : ""}
      <p class="who">${escape(clip.speaker)}<br><span class="muted">${escape(clip.program)} (${escape(clip.answer.station)})</span></p>
    </div>
    <table>${rows}</table>
    ${geeksHtml(clip)}
    <div class="player"><button class="play">Hear the original</button><div class="progress"><div></div></div></div>
    <div class="spectro"><canvas aria-label="Spectrogram of the original ${side}"></canvas></div>
    <p><a href="${clip.link}" target="_blank" rel="noopener">Source on YouTube</a></p>
  </div>`;
}

function geeksHtml(clip) {
  const rows = geekStatsRows(clip.stats);
  // Always emit the block: both reveal cards need the same sections to line up on the shared grid.
  if (rows.length === 0) return '<div class="geeks"></div>';
  // Definitions live in tooltips (hover a label) to keep the table compact.
  return `<div class="geeks"><h3>Stats for geeks</h3><table>${rows.map((r) =>
    `<tr><td><span class="term" title="${escape(r.hint)}">${r.label}</span></td><td>${escape(r.value)}</td></tr>`).join("")}</table></div>`;
}

function showReveal(round, picked, right, points) {
  const label = `Round ${game.index + 1} of ${game.rounds.length} · ${round.level}`;
  $("match-reveal-label").innerHTML = `${label}: <span class="${right ? "good" : "bad"}">${right ? `right, +${points}` : "not this time"}</span>`;
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
  for (const canvas of box.querySelectorAll("canvas")) clearSpectrogram(canvas);
}

// ---------- end ----------

function finish() {
  const s = summarizeMatch(game.results);
  const levelRows = LEVELS.filter((l) => s.byLevel[l].total > 0).map((l) =>
    `<tr><td>${l[0].toUpperCase() + l.slice(1)} (×${MATCH_CONFIG.points[l]})</td><td class="pts">${s.byLevel[l].right} / ${s.byLevel[l].total}</td></tr>`).join("");
  const hardRows = Object.entries(s.hardByAttribute).map(([attr, r]) =>
    `<tr><td>When only ${MATCH_CONFIG.attributeLabel[attr]} differed</td><td class="pts">${r.right} / ${r.total}</td></tr>`).join("");
  const note = game.fallbacks.length
    ? `<tr><td colspan="2" class="muted">${game.fallbacks.length} round${game.fallbacks.length === 1 ? "" : "s"} used an easier pair than planned: the corpus ran short.</td></tr>`
    : "";
  showEnd({
    score: `${s.total} / ${s.max}`,
    ids: game.ids,
    tableHtml: `<tr><th>Accuracy</th><th></th></tr>${levelRows}` +
      (hardRows ? `<tr><th>Hard rounds</th><th></th></tr>${hardRows}` : "") + note,
    buildRecord: (cues) => ({
      format: LOG_FORMAT,
      mode: "match",
      started: game.started,
      finished: new Date().toISOString(),
      settings: { pure: game.settings.pure, rounds: game.settings.rounds, timbre_at_start: game.settings.timbre },
      fallbacks: game.fallbacks,
      summary: s,
      rounds: game.records,
      cues,
    }),
  });
}
