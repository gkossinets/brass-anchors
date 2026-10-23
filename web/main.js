// Boot: load the manifest, set up the front page, and route by ?mode=.
// The URL is the single source of truth for the mode: picking a mode on the
// front page sets ?mode=, and Back returns to the front page.
import { modeFromSearch } from "./log-core.js";
import { $, show, stopAudio, startingTimbre, setHeader } from "./shared.js";
import { setupClassic, classicPoolSize, startClassic } from "./quiz.js";
import { startMatch } from "./match.js";
import { matchPoolSize, matchMaxRounds } from "./match-core.js";
import { collecting } from "./collect.js";

let corpus = [];
let timbres = [];

function settings() {
  return {
    variant: document.querySelector('input[name="variant"]:checked').value,
    country: $("chair-country").value,
    pure: $("pure").checked,
    rounds: Math.max(1, parseInt($("rounds").value, 10) || 10),
    // No picker on the front page: games start with the sound last chosen in a game's own switch.
    timbre: startingTimbre(timbres),
  };
}

function setupFrontPage() {
  $("collect-note").hidden = !collecting;
  setupClassic(corpus, timbres);
  const update = () => {
    const s = settings();
    const n = classicPoolSize(s);
    const m = matchPoolSize(corpus, s);
    const maxRounds = matchMaxRounds(corpus, s);
    $("clip-count").textContent =
      `${corpus.length} clips · ${m} for Match (up to ${maxRounds} rounds) · ${n} for this Guess the clip variant`;
    // A Match game never repeats a clip, so it can't run longer than maxRounds.
    const matchRounds = Math.min(s.rounds, maxRounds);
    // A Guess the clip game plays each clip once too, so it can't outrun its pool either.
    const classicRounds = Math.min(s.rounds, n);
    const rounds = (k) => `${k} round${k === 1 ? "" : "s"}`;
    $("match-strip").textContent = `Two clips a round · ${rounds(matchRounds)}`;
    $("classic-strip").textContent = `One clip a round · ${rounds(classicRounds)}`;
    $("start").disabled = n === 0;
    $("start-match").disabled = m < 2;
  };
  for (const el of document.querySelectorAll("#screen-start input, #screen-start select")) el.onchange = el.oninput = update;
  update();
}

function route() {
  stopAudio();
  const mode = modeFromSearch(location.search);
  const s = settings();
  if (mode === "classic") startClassic(s);
  else if (mode === "match") startMatch(corpus, timbres, s);
  else showFront();
}

function showFront() {
  const decades = corpus.map((c) => c.answer.decade).sort();
  setHeader({ kind: "front", span: decades.length ? `${decades[0]} to now` : "" });
  show("start");
}

function go(mode) {
  const url = mode ? `?mode=${mode}` : location.pathname;
  history.pushState(null, "", url);
  route();
}

$("start").onclick = () => go("classic");
$("start-match").onclick = () => go("match");
$("again").onclick = () => go(null);
// The logo and name lead home. A plain click switches screens without a reload, like
// New game; Cmd/Ctrl/Shift-clicks keep the browser's own behaviour (new tab, etc.).
$("home-link").onclick = (e) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go(null);
};
window.onpopstate = route;

fetch("quiz.json")
  .then((r) => {
    if (!r.ok) throw new Error(`quiz.json: HTTP ${r.status}`);
    return r.json();
  })
  .then((data) => {
    corpus = data.clips;
    timbres = data.timbres ?? [];
    setupFrontPage();
    route();
  })
  .catch((err) => {
    showFront();
    $("load-error").hidden = false;
    $("load-error").textContent =
      `Could not load clips (${err.message}). Build web/quiz.json with the pipeline and serve this folder over HTTP.`;
    $("start").disabled = $("start-match").disabled = true;
  });
