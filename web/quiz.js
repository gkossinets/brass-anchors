// "Guess the clip" (classic mode) and "Guess the language" screens: one clip a round,
// buttons to answer. Game rules live in quiz-core.js.
import {
  GENRES, decadeOptions, countryOptions, stationOptions, scoreRound,
  filterClips, questionsFor, hasBonus, maxScorePerRound, pickRounds, displayAnswer, pointsNote, guessMark,
  englishOnly, languageOptions, pickLanguageRounds, roundHint,
} from "./quiz-core.js";
import { LOG_FORMAT, createPlayLog, roundRecord } from "./log-core.js";
import { $, play, stopAudio, show, clearSpectrogram, renderTimbreSwitch, showEnd, setHeader } from "./shared.js";
import { formatClock } from "./display-core.js";
import { geeksHtml } from "./geeks.js";
import { newGameIds, send } from "./collect.js";

const LABELS = { decade: "Decade", country: "Country", genre: "News or opinion?", station: "Station (bonus)", language: "Language" };
const MODE_NAMES = { classic: "Guess the clip", language: "Guess the language" };

let corpus = [];
let timbres = [];
let game = null;

const escape = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

function header(answered) {
  const score = game.results.reduce((sum, r) => sum + r.score.total, 0);
  setHeader({ kind: "game", total: game.clips.length, current: game.index + 1, answered, score });
}

/** Fill Guess the clip's country choice on the front page: both, or one country. */
export function setupClassic(clips, timbreList) {
  corpus = clips;
  timbres = timbreList;
  const countries = [...new Set(englishOnly(corpus).map((c) => c.answer.country))].sort();
  const choice = (value, label, checked) =>
    `<label><input type="radio" name="clip-country" value="${value}"${checked ? " checked" : ""}> ${label}</label>`;
  $("clip-countries").insertAdjacentHTML("beforeend",
    [choice("both", "Both", true), ...countries.map((c) => choice(c, c, false))].join(""));
}

/** How many clips a classic game with these settings can draw from. */
export function classicPoolSize(settings) {
  return filterClips(corpus, settings).length;
}

/** Start a game; settings.variant "language" is the language game, anything else Guess the clip. */
export function startClassic(settings) {
  const pool = filterClips(corpus, settings);
  const language = settings.variant === "language";
  game = {
    ...settings,
    mode: language ? "language" : "classic",
    clips: language ? pickLanguageRounds(pool, settings.rounds) : pickRounds(pool, settings.rounds),
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
  if (question === "country") return countryOptions(a.country, englishOnly(corpus).map((c) => c.answer.country));
  if (question === "language") return languageOptions(corpus);
  if (question === "genre") return GENRES;
  // Stations from the clips this game plays: a French or Russian station would be a giveaway.
  return stationOptions(a.station, filterClips(corpus, game).map((c) => c.answer.station));
}

function renderQuestion(container, question, clip, guess, onChange) {
  const set = document.createElement("fieldset");
  set.className = `question${question === "station" ? " bonus" : ""}`;
  set.innerHTML = `<legend>${LABELS[question]} <span class="pts-note">${pointsNote(question)}</span></legend><div class="options"></div>`;
  for (const opt of optionsFor(question, clip)) {
    const b = document.createElement("button");
    b.textContent = displayAnswer(question, opt);
    b.setAttribute("aria-pressed", "false");
    b.onclick = () => {
      guess[question] = opt;
      for (const sib of set.querySelectorAll("button")) sib.setAttribute("aria-pressed", String(sib === b));
      onChange();
    };
    set.querySelector(".options").append(b);
  }
  container.append(set);
}

function showRound() {
  stopAudio();
  const clip = game.clips[game.index];
  const questions = questionsFor(game.variant);
  const guess = {};
  const heard = new Set();
  const plays = createPlayLog();

  const playCurrent = () => {
    const clock = (seconds, duration) => { $("play-clock").textContent = `${formatClock(seconds)} / ${formatClock(duration)}`; };
    if (play(clip.audio[game.timbre], $("play"), $("progress-bar"), "Play", $("spectrogram"), clock)) {
      heard.add(game.timbre);
      plays.played(clip.id);
    }
  };

  $("round-label").textContent = `Round ${game.index + 1} of ${game.clips.length} · ${MODE_NAMES[game.mode]}`;
  header(false);
  $("progress-bar").style.width = "0";
  $("play-clock").textContent = "0:00";
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
    const answered = questions.filter((q) => guess[q] !== undefined).length;
    const done = answered === questions.length;
    $("reveal").disabled = !done;
    if (done && hasBonus(game.variant) && bonus.hidden) bonus.hidden = false;
    $("round-hint").textContent = roundHint(answered, questions.length);
  };
  onChange();
  for (const q of questions) renderQuestion(qs, q, clip, guess, onChange);
  if (hasBonus(game.variant)) renderQuestion(bonus, "station", clip, guess, () => {});

  $("reveal").onclick = () => showReveal(clip, guess, heard, plays);
  show("round");
  clearSpectrogram($("spectrogram"));
}

function showReveal(clip, guess, heard, plays) {
  const msToAnswer = plays.msSinceFirstPlay();
  stopAudio();
  const score = scoreRound(clip.answer, guess);
  const asked = [...questionsFor(game.variant), ...(hasBonus(game.variant) ? ["station"] : [])];
  game.results.push({ id: clip.id, score });
  const record = roundRecord(game.mode, {
    round: game.index + 1, clipIds: [clip.id], plays: plays.counts(), msToAnswer, timbre: game.timbre,
  }, {
    clip_id: clip.id, guess: { ...guess }, score, timbres_heard: [...heard],
    // The language game's stats tally by the answer, which the round record otherwise lacks.
    ...(game.mode === "language" ? { language: clip.answer.language } : {}),
  });
  game.records.push(record);
  send("round", game.ids, record);

  $("reveal-label").textContent = `Round ${game.index + 1} of ${game.clips.length} · The answer`;
  $("reveal-points").textContent = `+${score.total}`;
  $("reveal-possible").textContent = `${score.total} of ${maxScorePerRound(game.variant)} possible`;
  $("reveal-table").innerHTML =
    "<thead><tr><th></th><th>Your guess</th><th>Answer</th><th class=\"pts\">Pts</th></tr></thead><tbody>" +
    asked.map((q) => {
      const m = guessMark(q, guess[q], score[q]);
      const shown = guess[q] === undefined ? m.mark : `${m.mark} ${escape(displayAnswer(q, guess[q]))}`;
      const note = m.note ? ` <span class="note-inline">${m.note}</span>` : "";
      return `<tr><th scope="row"${q === "station" ? ' class="bonus-label"' : ""}>${LABELS[q]}</th>` +
        `<td class="guess ${m.kind}">${shown}${note}</td>` +
        `<td>${escape(displayAnswer(q, clip.answer[q]))}</td><td class="pts">${score[q]}</td></tr>`;
    }).join("") + "</tbody>";
  const year = clip.year ? `, ${clip.year}` : "";
  $("reveal-who").textContent = clip.speaker;
  $("reveal-meta").textContent = `${clip.program} (${clip.answer.station}${year})`;
  $("reveal-geeks").innerHTML = geeksHtml(clip);
  header(true);
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
  // Enter or Space moves on; preventScroll keeps the page at the top.
  $("next").focus({ preventScroll: true });
  clearSpectrogram($("spectrogram-original"));
}

function finish() {
  const total = game.results.reduce((s, r) => s + r.score.total, 0);
  const max = maxScorePerRound(game.variant) * game.results.length;
  const byId = Object.fromEntries(corpus.map((c) => [c.id, c]));
  showEnd({
    score: `${total} / ${max}`,
    meta: `${MODE_NAMES[game.mode]} · ${game.results.length} round${game.results.length === 1 ? "" : "s"}`,
    ids: game.ids,
    mode: game.mode,
    scorePct: Math.round((100 * total) / max),
    tableHtml: game.mode === "language"
      ? "<tr><th>Speaker</th><th>Language</th><th></th></tr>" +
        game.results.map((r) => {
          const c = byId[r.id];
          return `<tr><td>${c.speaker}</td><td>${displayAnswer("language", c.answer.language)}</td><td class="pts">${r.score.total}</td></tr>`;
        }).join("")
      : "<tr><th>Speaker</th><th>Year</th><th></th></tr>" +
        game.results.map((r) => {
          const c = byId[r.id];
          return `<tr><td>${c.speaker}</td><td>${c.year ?? c.answer.decade}</td><td class="pts">${r.score.total}</td></tr>`;
        }).join(""),
    buildRecord: (cues) => ({
      format: LOG_FORMAT,
      mode: game.mode,
      started: game.started,
      finished: new Date().toISOString(),
      settings: {
        variant: game.variant,
        country: game.variant === "one-country" ? game.country : null,
        rounds: game.rounds,
        timbre_at_start: game.timbre_at_start,
      },
      summary: { total, max },
      rounds: game.records,
      cues,
    }),
  });
}
