// DOM wiring for the review page. Talks to pipeline/review_server.py.
import { formatTime, parseTime, sourceTime, changedFields, statusCounts } from "./review-core.js";

const $ = (id) => document.getElementById(id);
const form = $("form");
const FIELDS = ["review_status", "review_notes", "thumbnail_ok", "start", "end", "speaker", "sex", "genre", "country", "language", "decade",
  "year", "station", "program", "recognizable", "date_confidence", "notes"];

let clips = [];
let current = null;
let contextWindowStart = 0;

// ---------- list ----------

function renderList() {
  const filter = $("filter").value;
  const counts = statusCounts(clips);
  $("counts").textContent = `${clips.length} clips · ${counts.approved} approved · ${counts.needs_fix} need fixes · ` +
    `${counts.rejected} rejected · ${counts.unreviewed} unreviewed`;
  const list = $("clip-list");
  list.innerHTML = "";
  for (const clip of clips) {
    const status = clip.review_status || "unreviewed";
    if (filter !== "all" && status !== filter) continue;
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = clip.id === current?.id ? "current" : "";
    b.innerHTML = `<span class="dot ${status}"></span><span>${clip.speaker}<br><small>${clip.id}</small></span>`;
    b.onclick = () => select(clip.id);
    li.append(b);
    list.append(li);
  }
}

// ---------- detail ----------

function formValues() {
  const data = new FormData(form);
  return Object.fromEntries(FIELDS.map((f) => [f, data.get(f) ?? ""]));
}

function isDirty() {
  return current && Object.keys(changedFields(current, formValues())).length > 0;
}

function select(id) {
  if (isDirty() && !confirm("Discard unsaved changes to this clip?")) return;
  current = clips.find((c) => c.id === id);
  showDetail();
  renderList();
  history.replaceState(null, "", `#${id}`);
}

function showDetail() {
  const c = current;
  $("detail").hidden = false;
  $("title").textContent = `${c.speaker}: ${c.program} (${c.station}, ${c.year || c.decade})`;
  $("clip-id").textContent = c.id;
  const sep = c.url.includes("?") ? "&" : "?";
  $("source").href = `${c.url}${sep}t=${Math.floor(parseTime(c.start))}s`;

  const len = parseTime(c.end) - parseTime(c.start);
  const s = c.stats;
  const warn = s?.steady_tones?.length
    ? ` · <span class="warn">steady tone at ${s.steady_tones.map(([a, b]) => `${a}–${b} s`).join(", ")} (bleep? music?)</span>`
    : "";
  $("stats").innerHTML = `${len.toFixed(1)} s` +
    (s ? ` · ${s.voiced_pct}% voiced · median f0 ${s.median_f0} Hz${warn}` : " · <span class=\"warn\">not built yet</span>");

  for (const kind of ["original", "trombone"]) {
    const el = $(`audio-${kind}`);
    el.pause();
    if (c.media[kind]) el.src = c.media[kind]; else el.removeAttribute("src");
  }
  $("portrait").hidden = !c.media.thumbnails;
  $("thumbnail-ok-box").hidden = !c.media.thumbnails;
  if (c.media.thumbnails) $("portrait").src = c.media.thumbnails; else $("portrait").removeAttribute("src");
  $("diagnostic").src = c.media.diagnostics ?? "";
  $("diag-link").href = c.media.diagnostics ?? "#";

  $("context-box").hidden = true;
  $("audio-context").pause();
  $("load-context").disabled = false;
  $("load-context").textContent = "Load context (±5 s around the cut)";

  for (const field of FIELDS) {
    const value = c[field] ?? "";
    if (field === "review_status") {
      for (const r of form.querySelectorAll('input[name="review_status"]')) r.checked = r.value === value;
    } else if (field === "thumbnail_ok") {
      form.elements.thumbnail_ok.checked = value === "yes";
    } else {
      form.elements[field].value = value;
    }
  }
  $("save-status").textContent = "";
  $("log-box").hidden = true;
}

// ---------- context ----------

async function loadContext() {
  $("load-context").disabled = true;
  $("load-context").textContent = "Downloading context…";
  try {
    const r = await fetch(`/api/clips/${current.id}/context`, { method: "POST" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    contextWindowStart = body.window_start;
    $("audio-context").src = body.audio;
    const offset = (t) => (t - body.window_start).toFixed(1);
    $("context-note").textContent = `This audio starts at ${formatTime(body.window_start)}. ` +
      `The current cut runs from ${offset(body.clip_start)} s to ${offset(body.clip_end)} s in it.`;
    $("context-box").hidden = false;
    $("load-context").textContent = "Reload context";
  } catch (err) {
    $("load-context").textContent = `Context failed: ${err.message}`;
  } finally {
    $("load-context").disabled = false;
  }
}

function setFromContext(field) {
  form.elements[field].value = formatTime(sourceTime(contextWindowStart, $("audio-context").currentTime));
}

// ---------- save ----------

async function save() {
  const changes = changedFields(current, formValues());
  if (Object.keys(changes).length === 0) {
    $("save-status").textContent = "No changes.";
    return true;
  }
  const recut = "start" in changes || "end" in changes;
  $("save").disabled = $("save-next").disabled = true;
  $("save-status").textContent = recut ? "Saving, re-cutting and rebuilding audio (10-30 s)…" : "Saving…";
  try {
    const r = await fetch(`/api/clips/${current.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    clips[clips.findIndex((c) => c.id === current.id)] = body.clip;
    current = body.clip;
    showDetail();
    renderList();
    $("save-status").textContent = body.rebuilt ? "Saved and rebuilt. Listen again." : "Saved.";
    $("log").textContent = body.log;
    $("log-box").hidden = !body.log.trim();
    return true;
  } catch (err) {
    $("save-status").innerHTML = `<span class="warn">Not saved: ${err.message}</span>`;
    return false;
  } finally {
    $("save").disabled = $("save-next").disabled = false;
  }
}

async function saveAndNext() {
  if (!(await save())) return;
  const start = clips.findIndex((c) => c.id === current.id);
  const next = [...clips.slice(start + 1), ...clips.slice(0, start)].find((c) => !c.review_status || c.review_status === "unreviewed");
  if (next) select(next.id);
  else $("save-status").textContent = "Saved. Every clip has been reviewed.";
}

// ---------- boot ----------

form.onsubmit = (e) => { e.preventDefault(); save(); };
$("save-next").onclick = saveAndNext;
$("filter").onchange = renderList;
$("load-context").onclick = loadContext;
$("set-start").onclick = () => setFromContext("start");
$("set-end").onclick = () => setFromContext("end");
$("audio-context").ontimeupdate = () => {
  $("context-pos").textContent = `at ${formatTime(sourceTime(contextWindowStart, $("audio-context").currentTime))}`;
};
window.onbeforeunload = (e) => { if (isDirty()) e.preventDefault(); };

fetch("/api/clips")
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then((data) => {
    clips = data.clips;
    renderList();
    const wanted = location.hash.slice(1);
    select(clips.some((c) => c.id === wanted) ? wanted : clips[0].id);
  })
  .catch((err) => {
    $("load-error").hidden = false;
    $("load-error").textContent = `Could not load clips (${err.message}). Start the review server with \`make review\`.`;
  });
