// "Guess the clip" (classic mode) screens. Game rules live in quiz-core.js.
import {
  GENRES, decadeOptions, countryOptions, stationOptions, scoreRound,
  filterClips, questionsFor, hasBonus, maxScorePerRound, pickRounds, POINTS, displayAnswer,
} from "./quiz-core.js";
import { LOG_FORMAT, createPlayLog, roundRecord } from "./log-core.js";
import { $, play, stopAudio, show, clearSpectrogram, renderTimbreSwitch, showEnd } from "./shared.js";
import { newGameIds, send } from "./collect.js";

const LABELS = { decade: "Decade", country: "Country", genre: "News or opinion?", station: "Station (bonus)" };

let corpus = [];
let timbres = [];
let game = null;

/** Fill the classic-only parts of the front page (same-chair country list). */
export function setupClassic(clips, timbreList) {
  corpus = clips;
  timbres = timbreList;
  const countries = [...new Set(corpus.map((c) => c.answer.country))].sort();
  $("chair-country").innerHTML = countries.map((c) => `<option>${c}</option>`).join("");
}

/** How many clips a classic game with these settings can draw from. */
export function classicPoolSize(settings) {
  return filterClips(corpus, settings).length;
}

export function startClassic(settings) {
  game = {
    ...settings,
    clips: pickRounds(filterClips(corpus, settings), settings.rounds),
    index: 0,
    results: [],
    records: [],
    started: new Date().toISOString(),
    timbre_at_start: settings.timbre,
    ids: newGameIds(),
  };
  showRound();
}

function optionsFor(question, clip) {
  const a = clip.answer;
  if (question === "decade") return decadeOptions(a.decade);
  if (question === "country") return countryOptions(a.country, corpus.map((c) => c.answer.country));
  if (question === "genre") return GENRES;
  return stationOptions(a.station, corpus.map((c) => c.answer.station));
}

function renderQuestion(container, question, clip, guess, onChange) {
  const div = document.createElement("div");
  div.className = "question";
  div.innerHTML = `<h3>${LABELS[question]}</h3><div class="options"></div>`;
  for (const opt of optionsFor(question, clip)) {
    const b = document.createElement("button");
    b.textContent = displayAnswer(question, opt);
    b.onclick = () => {
      guess[question] = opt;
      for (const sib of div.querySelectorAll("button")) sib.classList.toggle("chosen", sib === b);
      onChange();
    };
    div.querySelector(".options").append(b);
  }
  container.append(div);
}

function showRound() {
  stopAudio();
  const clip = game.clips[game.index];
  const questions = questionsFor(game.variant);
  const guess = {};
  const heard = new Set();
  const plays = createPlayLog();

  const playCurrent = () => {
    if (play(clip.audio[game.timbre], $("play"), $("progress-bar"), "Play", $("spectrogram"))) {
      heard.add(game.timbre);
      plays.played(clip.id);
    }
  };

  $("round-label").textContent = `Round ${game.index + 1} of ${game.clips.length}`;
  $("progress-bar").style.width = "0";
  $("play").textContent = "Play";
  $("play").onclick = playCurrent;
  renderTimbreSwitch($("timbre-switch"), timbres, game.timbre, (id) => {
    game.timbre = id;
    stopAudio();
    playCurrent();
  });

  const qs = $("questions");
  const bonus = $("bonus");
  qs.innerHTML = "";
  bonus.innerHTML = "";
  bonus.hidden = true;
  $("reveal").disabled = true;

  const onChange = () => {
    const done = questions.every((q) => guess[q] !== undefined);
    $("reveal").disabled = !done;
    if (done && hasBonus(game.variant) && bonus.hidden) bonus.hidden = false;
  };
  for (const q of questions) renderQuestion(qs, q, clip, guess, onChange);
  if (hasBonus(game.variant)) renderQuestion(bonus, "station", clip, guess, () => {});

  $("reveal").onclick = () => showReveal(clip, guess, heard, plays);
  show("round");
  clearSpectrogram($("spectrogram"));
}

function cls(points, max) {
  return points === max ? "good" : points > 0 ? "part" : "bad";
}

function showReveal(clip, guess, heard, plays) {
  const msToAnswer = plays.msSinceFirstPlay();
  stopAudio();
  const score = scoreRound(clip.answer, guess);
  const asked = [...questionsFor(game.variant), ...(hasBonus(game.variant) ? ["station"] : [])];
  game.results.push({ id: clip.id, score });
  const record = roundRecord("classic", {
    round: game.index + 1, clipIds: [clip.id], plays: plays.counts(), msToAnswer, timbre: game.timbre,
  }, { clip_id: clip.id, guess: { ...guess }, score, timbres_heard: [...heard] });
  game.records.push(record);
  send("round", game.ids, record);

  $("reveal-label").textContent = `Round ${game.index + 1} of ${game.clips.length}: +${score.total}`;
  $("reveal-table").innerHTML =
    "<tr><th></th><th>Your guess</th><th>Answer</th><th></th></tr>" +
    asked.map((q) => `<tr><td>${LABELS[q]}</td><td class="${cls(score[q], POINTS[q])}">${displayAnswer(q, guess[q]) ?? "—"}</td>` +
      `<td>${displayAnswer(q, clip.answer[q])}</td><td class="pts">${score[q]}</td></tr>`).join("");
  const year = clip.year ? `, ${clip.year}` : "";
  $("reveal-who").textContent = `${clip.speaker}: ${clip.program} (${clip.answer.station}${year})`;
  const thumb = $("reveal-thumb");
  thumb.hidden = !clip.thumbnail;
  if (clip.thumbnail) {
    thumb.src = clip.thumbnail;
    thumb.alt = clip.speaker;
  } else {
    thumb.removeAttribute("src");
  }

  $("progress-bar-original").style.width = "0";
  $("play-original").textContent = "Hear the original";
  $("play-original").onclick = () =>
    play(clip.audio.original, $("play-original"), $("progress-bar-original"), "Hear the original",
      $("spectrogram-original"));
  $("youtube-link").href = clip.link;

  game.index += 1;
  $("next").textContent = game.index < game.clips.length ? "Next" : "Finish";
  $("next").onclick = () => (game.index < game.clips.length ? showRound() : finish());
  show("reveal");
  clearSpectrogram($("spectrogram-original"));
}

function finish() {
  const total = game.results.reduce((s, r) => s + r.score.total, 0);
  const max = maxScorePerRound(game.variant) * game.results.length;
  const byId = Object.fromEntries(corpus.map((c) => [c.id, c]));
  showEnd({
    score: `${total} / ${max}`,
    ids: game.ids,
    tableHtml: "<tr><th>Speaker</th><th>Year</th><th></th></tr>" +
      game.results.map((r) => {
        const c = byId[r.id];
        return `<tr><td>${c.speaker}</td><td>${c.year ?? c.answer.decade}</td><td class="pts">${r.score.total}</td></tr>`;
      }).join(""),
    buildRecord: (cues) => ({
      format: LOG_FORMAT,
      mode: "classic",
      started: game.started,
      finished: new Date().toISOString(),
      settings: {
        variant: game.variant,
        country: game.variant === "same-chair" ? game.country : null,
        pure: game.pure,
        rounds: game.rounds,
        timbre_at_start: game.timbre_at_start,
      },
      rounds: game.records,
      cues,
    }),
  });
}
