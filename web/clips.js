// Clip stats page: speech measurements by group, standouts, and each game's hardest clips.
// Rules live in clips-core.js; this module only draws.
import { measuresFor, parseBy, groupOf, groupRows, standouts, axis, chartCaption, formatValue, valueOf, MEASURES } from "./clips-core.js";
import { displayAnswer } from "./quiz-core.js";

const $ = (id) => document.getElementById(id);
const escape = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const BY_LABELS = { language: "Language", decade: "Decade", sex: "Women / men" };
const GAMES = { language: "Guess the language", match: "Match the clue", classic: "Guess the clip" };

let clips = [];
let clipsById = {};
let difficulty = null; // null until /api/clip-stats answers; false if it failed
let by = parseBy(location.search);
let game = "language";

// ---------- hardest to get right ----------

function clipCell(id) {
  const c = clipsById[id];
  if (!c) return escape(id); // a clip since removed from the game
  const thumb = c.thumbnail ? `<img class="thumb" src="${escape(c.thumbnail)}" alt="">` : "";
  const when = c.year ?? c.answer.decade;
  return `<span class="clip-cell">${thumb}<span>${escape(c.speaker)}<br><span class="muted">${escape(c.program)}, ${escape(when)} · ${escape(groupOf(c, "language"))}</span></span></span>`;
}

function renderHardest() {
  for (const tab of document.querySelectorAll("[data-game]")) tab.setAttribute("aria-selected", String(tab.dataset.game === game));
  const note = $("hardest-note");
  $("mistaken-box").hidden = true;
  if (difficulty === null) {
    $("hardest").innerHTML = `<tr><td class="muted">Loading…</td></tr>`;
    return;
  }
  if (difficulty === false) {
    $("hardest").innerHTML = `<tr><td class="muted">Play results couldn't be loaded right now.</td></tr>`;
    note.textContent = "";
    return;
  }
  const list = difficulty[game].hardest;
  $("hardest").innerHTML = list.length
    ? `<tr><th>Clip</th><th class="num">Missed</th></tr>` +
      list.map((e) => `<tr><td>${clipCell(e.clip)}</td><td class="num">${e.missed} of ${e.n}</td></tr>`).join("")
    : `<tr><td class="muted">Not enough plays yet: a clip needs ${difficulty.minAttempts} plays in ${GAMES[game]} to be ranked.</td></tr>`;
  note.textContent = `Counts every game, replays included. ${game === "match"
    ? "A wrong pick counts against the clip that fit the description."
    : game === "classic" ? "A round counts as missed when any question scored nothing; a decade one off still scores." : ""}`;
  if (game === "language") renderMistaken(difficulty.language.mistakenFor);
}

function renderMistaken(mistakenFor) {
  const truths = Object.keys(mistakenFor);
  if (truths.length === 0) return;
  const guesses = [...new Set(truths.flatMap((t) => Object.keys(mistakenFor[t])))];
  const name = (l) => escape(displayAnswer("language", l));
  $("mistaken").innerHTML = `<tr><th>It was</th>${guesses.map((g) => `<th class="num">Said ${name(g)}</th>`).join("")}</tr>` +
    truths.map((t) => `<tr><td>${name(t)}</td>${guesses.map((g) => `<td class="num">${mistakenFor[t][g] ?? "—"}</td>`).join("")}</tr>`).join("");
  $("mistaken-box").hidden = false;
}

// ---------- group switch, table, standouts ----------

function renderSwitches() {
  for (const box of document.querySelectorAll(".group-switch")) {
    box.innerHTML = Object.entries(BY_LABELS).map(([key, label]) =>
      `<button type="button" role="tab" class="tab" data-by="${key}" aria-selected="${key === by}">${label}</button>`).join("");
  }
}

function renderGlance(rows) {
  const measures = measuresFor(by).filter((m) => m.inTable);
  $("glance").innerHTML = `<tr><th></th><th class="num">Clips</th>${measures.map((m) => `<th class="num">${m.short}</th>`).join("")}</tr>` +
    rows.map((r) => `<tr><td>${escape(r.group)}</td><td class="num">${r.n}</td>` +
      measures.map((m) => `<td class="num">${formatValue(r.medians[m.id], m)}</td>`).join("") + "</tr>").join("");
}

function renderStandouts() {
  const measureFor = (key) => MEASURES.find((m) => m.key === key && !m.sex);
  $("standouts").innerHTML = standouts(clips).map(({ label, key, clip, value }) =>
    `<li><span class="eyebrow">${escape(label)}</span><span><strong>${escape(clip.speaker)}</strong> ` +
    `<span class="muted">(${escape(groupOf(clip, "language"))}, ${escape(clip.year ?? clip.answer.decade)})</span></span>` +
    `<span class="standout-value">${formatValue(value, measureFor(key))}</span></li>`).join("");
}

// ---------- dot charts ----------

function chart(measure, rows) {
  const box = $("charts");
  const narrow = box.clientWidth < 520;
  // On a phone the group name sits above its row, so the dots get the full width.
  const W = Math.max(300, box.clientWidth), rowH = narrow ? 40 : 30, top = narrow ? 30 : 22, left = narrow ? 6 : 112, right = narrow ? 56 : 76;
  const H = top + rows.length * rowH + 14;
  const groups = rows.map((r) => r.group);
  const members = clips.filter((c) => valueOf(c, measure) !== null && groups.includes(groupOf(c, by)));
  if (members.length === 0) return "";
  const { lo, hi, ticks } = axis(members.map((c) => valueOf(c, measure)));
  const x = (v) => left + ((v - lo) / (hi - lo)) * (W - left - right);
  const y = (g) => top + groups.indexOf(g) * rowH + rowH / 2;
  const extreme = members.reduce((a, b) => (valueOf(b, measure) > valueOf(a, measure) ? b : a));

  const parts = [];
  for (const r of rows) {
    const ry = y(r.group);
    parts.push(narrow
      ? `<text class="row-label" x="${left}" y="${ry - 11}">${escape(r.group)}</text>`
      : `<text class="row-label" x="${left - 10}" y="${ry + 4}" text-anchor="end">${escape(r.group)}</text>`,
    `<line class="row-rule" x1="${left}" x2="${W - right}" y1="${ry}" y2="${ry}"></line>`,
    `<text class="row-value" x="${W}" y="${ry + 4}" text-anchor="end">${formatValue(r.medians[measure.id], measure)}</text>`);
  }
  for (const c of members) {
    const v = valueOf(c, measure), cx = x(v), cy = y(groupOf(c, by));
    const tip = `${c.speaker} · ${groupOf(c, "language")}, ${c.year ?? c.answer.decade} · ${formatValue(v, measure)}`;
    parts.push(`<g class="clip-mark" data-tip="${escape(tip)}"><circle class="hit" cx="${cx}" cy="${cy}" r="12"></circle>` +
      `<circle class="clip-dot ${c.sex === "f" ? "f" : "m"}" cx="${cx}" cy="${cy}" r="5"><title>${escape(tip)}</title></circle></g>`);
  }
  // Medians over the dots, so a clip sitting on its group's median doesn't hide it.
  for (const r of rows) {
    const m = r.medians[measure.id], ry = y(r.group);
    if (m !== null) parts.push(`<line class="median-bar" x1="${x(m)}" x2="${x(m)}" y1="${ry - 10}" y2="${ry + 10}"></line>`);
  }
  const ex = x(valueOf(extreme, measure)), ey = y(groupOf(extreme, by));
  parts.push(`<text class="extreme-label" x="${ex}" y="${ey - 10}" text-anchor="${ex > W - right - 60 ? "end" : "middle"}">${escape(extreme.speaker)}</text>`);
  for (const t of ticks) {
    parts.push(`<text class="tick" x="${x(t)}" y="${H - 2}" text-anchor="middle">${formatValue(t, { ...measure, digits: Number.isInteger(t) ? 0 : 1 })}</text>`);
  }
  return `<figure class="dot-chart"><figcaption><strong>${measure.label}</strong> <span class="muted">${escape(chartCaption(rows, measure))}</span></figcaption>` +
    `<svg width="${W}" height="${H}" role="img" aria-label="${escape(measure.label)}, one dot per clip">${parts.join("")}</svg></figure>`;
}

function renderCharts(rows) {
  $("charts").innerHTML = measuresFor(by).map((m) => chart(m, rows)).join("");
}

function renderGroups() {
  const rows = groupRows(clips, by);
  renderSwitches();
  renderGlance(rows);
  renderCharts(rows);
}

// ---------- interaction ----------

function showTip(mark, event) {
  const tip = $("chart-tip");
  tip.textContent = mark.dataset.tip; // untrusted: textContent, not innerHTML
  tip.hidden = false;
  const pad = 12;
  const left = Math.min(event.clientX + pad, window.innerWidth - tip.offsetWidth - pad);
  tip.style.left = `${Math.max(pad, left)}px`;
  tip.style.top = `${Math.max(pad, event.clientY - tip.offsetHeight - pad)}px`;
}

function wire() {
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-game]");
    if (g) { game = g.dataset.game; renderHardest(); return; }
    const b = e.target.closest("[data-by]");
    if (b && b.dataset.by !== by) {
      by = b.dataset.by;
      const url = new URL(location.href);
      url.searchParams.set("by", by);
      history.replaceState(null, "", url);
      renderGroups();
    }
  });
  $("charts").addEventListener("pointerover", (e) => {
    const mark = e.target.closest(".clip-mark");
    if (mark) showTip(mark, e);
  });
  $("charts").addEventListener("pointerout", (e) => {
    if (e.target.closest(".clip-mark")) $("chart-tip").hidden = true;
  });
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderCharts(groupRows(clips, by)), 150);
  });
}

async function main() {
  wire();
  renderHardest();
  try {
    const quiz = await (await fetch("quiz.json")).json();
    clips = quiz.clips;
    clipsById = Object.fromEntries(clips.map((c) => [c.id, c]));
  } catch {
    $("load-error").textContent = "The clip list couldn't be loaded.";
    $("load-error").hidden = false;
    return;
  }
  renderGroups();
  renderStandouts();
  try {
    const res = await fetch("/api/clip-stats");
    if (!res.ok) throw new Error(res.status);
    difficulty = await res.json();
  } catch {
    difficulty = false;
  }
  renderHardest();
}

main();
