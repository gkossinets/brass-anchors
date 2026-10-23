// Results page: everyone's scores and the easiest and hardest comparisons, from /api/stats.
import { histogram, percentBelow, clipLabel, pageParams, pct } from "./stats-view-core.js";
import { MATCH_CONFIG } from "./match-core.js";

const $ = (id) => document.getElementById(id);
const escape = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const secs = (ms) => (ms === null || ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`);
const QUESTION_LABELS = { decade: "Decade", country: "Country", genre: "News or opinion", station: "Station (bonus)" };

const { mode, you } = pageParams(location.search);
let clipsById = {};

function rows(headers, body, empty) {
  if (body.length === 0) return `<tr><td class="muted">${empty}</td></tr>`;
  return `<tr>${headers.map((h, i) => `<th${i ? ' class="num"' : ""}>${h}</th>`).join("")}</tr>` +
    body.map((cells) => `<tr>${cells.map((c, i) => `<td${i ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("");
}

function kpi(value, label) {
  return `<div class="kpi"><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div>`;
}

function median(xs) {
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}

// ---------- score histogram (SVG, one series; your bin in the accent colour) ----------

function scoreChart(scores) {
  const bins = histogram(scores);
  const yourBin = you === null ? -1 : Math.min(9, Math.floor(you / 10));
  const max = Math.max(1, ...bins.map((b) => b.count));
  const step = max <= 5 ? 1 : Math.ceil(max / 4);
  const top = Math.ceil(max / step) * step;
  // Drawn at the width it has (not scaled down), so labels stay legible on a phone.
  const W = Math.max(280, $("score-chart").clientWidth - 24), H = 220, left = 32, right = 8, plotTop = 20, bottom = 28;
  const plotW = W - left - right, plotH = H - plotTop - bottom;
  const slot = plotW / bins.length;
  const y = (v) => plotTop + plotH - (v / top) * plotH;

  const grid = [];
  for (let v = 0; v <= top; v += step) {
    grid.push(`<line class="grid" x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}"/>` +
      `<text class="tick" x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  }
  const bars = bins.map((b, i) => {
    const x = left + i * slot + 1; // 2px surface gap between touching bins
    const w = slot - 2;
    const h = (b.count / top) * plotH;
    const r = Math.min(4, h, w / 2);
    // Rounded data end, square at the baseline.
    const path = h <= 0 ? "" : `M${x},${y(0)} V${y(b.count) + r} Q${x},${y(b.count)} ${x + r},${y(b.count)} H${x + w - r} Q${x + w},${y(b.count)} ${x + w},${y(b.count) + r} V${y(0)} Z`;
    const label = `${b.label}: ${b.count} game${b.count === 1 ? "" : "s"}${i === yourBin ? " (your score)" : ""}`;
    return `<g class="bin${i === yourBin ? " yours" : ""}" tabindex="0" role="img" aria-label="${label}" data-tip="${label}">` +
      `<rect class="hit" x="${x}" y="${plotTop}" width="${w}" height="${plotH}"/>` +
      (path ? `<path class="bar" d="${path}"/>` : "") +
      (i === yourBin ? `<text class="you-label" x="${x + w / 2}" y="${y(b.count) - 6}" text-anchor="middle">You</text>` : "") +
      `</g>`;
  }).join("");
  const xTicks = [0, 2, 4, 6, 8, 10].map((i) =>
    `<text class="tick" x="${left + i * slot}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === 10 ? "end" : "middle"}">${i * 10}%</text>`).join("");

  $("score-chart").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Number of finished games by final score">` +
    `${grid.join("")}<line class="axis" x1="${left}" x2="${W - right}" y1="${y(0)}" y2="${y(0)}"/>${bars}${xTicks}</svg>` +
    `<div class="tip" hidden></div>`;
  $("score-table").innerHTML = rows(["Score", "Games"], bins.map((b) => [b.label + (bins.indexOf(b) === yourBin ? " (you)" : ""), b.count]), "");
  wireTooltip($("score-chart"));
}

function wireTooltip(figure) {
  const tip = figure.querySelector(".tip");
  const showFor = (g, x, y) => {
    tip.textContent = g.dataset.tip;
    tip.hidden = false;
    const box = figure.getBoundingClientRect();
    tip.style.left = `${Math.min(x - box.left + 12, box.width - tip.offsetWidth - 4)}px`;
    tip.style.top = `${y - box.top - 36}px`;
  };
  for (const g of figure.querySelectorAll(".bin")) {
    g.addEventListener("pointermove", (e) => showFor(g, e.clientX, e.clientY));
    g.addEventListener("focus", () => {
      const r = g.getBoundingClientRect();
      showFor(g, r.left + r.width / 2, r.top + 24);
    });
    g.addEventListener("pointerleave", () => { tip.hidden = true; });
    g.addEventListener("blur", () => { tip.hidden = true; });
  }
}

// ---------- sections ----------

function renderScores(scores, data) {
  const finishedHere = scores.length;
  $("kpis").innerHTML =
    kpi(finishedHere, `finished game${finishedHere === 1 ? "" : "s"}`) +
    kpi(finishedHere ? `${median(scores)}%` : "—", "median score") +
    kpi(data.players, `player${data.players === 1 ? "" : "s"}, both modes`);
  const below = you === null ? null : percentBelow(scores, you);
  $("you-line").innerHTML = you === null ? "" : below === null ? `You scored ${you}%.`
    : `You scored <strong>${you}%</strong>, higher than ${below}% of finished games.`;
  if (finishedHere === 0) {
    $("score-chart").innerHTML = '<p class="muted">No finished games yet.</p>';
    $("score-table").innerHTML = "";
  } else {
    scoreChart(scores);
    let lastWidth = $("score-chart").clientWidth;
    addEventListener("resize", () => {
      if ($("score-chart").clientWidth !== lastWidth) {
        lastWidth = $("score-chart").clientWidth;
        scoreChart(scores);
      }
    });
  }
}

function pairRow(p) {
  return [`${escape(clipLabel(p.clips[0], clipsById))}<br>vs ${escape(clipLabel(p.clips[1], clipsById))}`,
    pct(p.right, p.n), secs(p.medianMs), p.n];
}

function renderMatch(m, minAttempts) {
  const levels = Object.entries(m.byLevel).map(([level, t]) =>
    [`${level[0].toUpperCase()}${level.slice(1)} (×${MATCH_CONFIG.points[level]})`, pct(t.right, t.n), secs(t.medianMs), t.n]);
  $("level-table").innerHTML = rows(["Level", "Right", "Median time", "Rounds"], levels, "No rounds played yet.");
  const attrs = Object.entries(m.hardByAttribute).map(([attr, t]) =>
    [`Only ${MATCH_CONFIG.attributeLabel[attr] ?? attr}`, pct(t.right, t.n), secs(t.medianMs), t.n]);
  $("attribute-table").innerHTML = rows(["Differed in", "Right", "Median time", "Rounds"], attrs, "No hard rounds yet.");
  const notYet = `Not enough plays yet: a comparison needs ${minAttempts} attempts to be ranked.`;
  $("hardest-pairs").innerHTML = rows(["Clips", "Right", "Median time", "Attempts"], m.hardest.map(pairRow), notYet);
  $("easiest-pairs").innerHTML = rows(["Clips", "Right", "Median time", "Attempts"], m.easiest.map(pairRow), notYet);
}

function clipRow(c) {
  return [escape(clipLabel(c.clip, clipsById)), pct(Math.round(c.exactShare * 100), 100), secs(c.medianMs), c.n];
}

function renderClassic(c, minAttempts) {
  const qs = Object.entries(c.byQuestion).map(([q, t]) => [QUESTION_LABELS[q] ?? q, pct(t.exact, t.n), t.n]);
  $("question-table").innerHTML = rows(["Question", "Exactly right", "Answers"], qs, "No rounds played yet.");
  const notYet = `Not enough plays yet: a clip needs ${minAttempts} plays to be ranked.`;
  $("hardest-clips").innerHTML = rows(["Clip", "Exactly right", "Median time", "Plays"], c.hardest.map(clipRow), notYet);
  $("easiest-clips").innerHTML = rows(["Clip", "Exactly right", "Median time", "Plays"], c.easiest.map(clipRow), notYet);
}

// ---------- boot ----------

$(`tab-${mode}`).setAttribute("aria-current", "page");
$("match-sections").hidden = mode !== "match";
$("classic-sections").hidden = mode !== "classic";

Promise.all([
  fetch("api/stats").then((r) => {
    if (!r.ok || !(r.headers.get("Content-Type") ?? "").includes("json")) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }),
  fetch("quiz.json").then((r) => (r.ok ? r.json() : { clips: [] })),
]).then(([data, quiz]) => {
  clipsById = Object.fromEntries(quiz.clips.map((c) => [c.id, c]));
  renderScores(data.scores[mode] ?? [], data);
  if (mode === "match") renderMatch(data.match, data.minAttempts);
  else renderClassic(data.classic, data.minAttempts);
  $("footnote").textContent = "Times run from the first Play to the answer. Right = share of rounds answered correctly; " +
    "\"exactly right\" for Guess the clip counts full marks only. Anonymous: no names or notes are shown.";
  $("stats-status").hidden = true;
  $("stats-body").hidden = false;
}).catch((err) => {
  $("stats-status").textContent = `Results aren't available here (${err.message}). They're collected on the deployed site; locally, use make site-dev.`;
});
