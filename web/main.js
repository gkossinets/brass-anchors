// Boot: load the manifest, set up the front page, and route by ?mode=.
// The URL is the single source of truth for the mode: picking a mode on the
// front page sets ?mode=, and Back returns to the front page.
import { modeFromSearch } from "./log-core.js";
import { $, show, stopAudio, startingTimbre } from "./shared.js";
import { setupClassic, classicPoolSize, startClassic } from "./quiz.js";
import { startMatch } from "./match.js";
import { matchPoolSize } from "./match-core.js";
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
    $("clip-count").textContent =
      `${corpus.length} clips in the corpus. With these options, "Match the description" can use ${m} ` +
      `and "Guess the clip" (the variant ticked) ${n}.`;
    $("start").disabled = n === 0;
    $("start-match").disabled = m < 2;
  };
  for (const el of document.querySelectorAll("#screen-start input, #screen-start select")) el.onchange = update;
  update();
}

function route() {
  stopAudio();
  const mode = modeFromSearch(location.search);
  const s = settings();
  if (mode === "classic") startClassic(s);
  else if (mode === "match") startMatch(corpus, timbres, s);
  else show("start");
}

function go(mode) {
  const url = mode ? `?mode=${mode}` : location.pathname;
  history.pushState(null, "", url);
  route();
}

$("start").onclick = () => go("classic");
$("start-match").onclick = () => go("match");
$("again").onclick = () => go(null);
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
    show("start");
    $("load-error").hidden = false;
    $("load-error").textContent =
      `Could not load clips (${err.message}). Build web/quiz.json with the pipeline and serve this folder over HTTP.`;
    $("start").disabled = $("start-match").disabled = true;
  });
