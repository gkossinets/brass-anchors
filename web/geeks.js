// The "Stats for geeks" panel shown on both modes' reveals. Rows come from geekStatsRows (match-core.js).
import { geekStatsRows } from "./match-core.js";

const escape = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

/** The panel's HTML for one clip; an empty panel when the clip has no stats. */
export function geeksHtml(clip) {
  const rows = geekStatsRows(clip.stats);
  // Always emit the block: Match's two reveal cards need the same sections to line up on their shared grid.
  if (rows.length === 0) return '<div class="geeks"></div>';
  // Definitions live in tooltips (hover a label) to keep the table compact.
  return `<div class="geeks"><p class="eyebrow accent">Stats for geeks</p><table>${rows.map((r) =>
    `<tr><td><span class="term" title="${escape(r.hint)}">${r.label}</span></td><td>${escape(r.value)}</td></tr>`).join("")}</table></div>`;
}
