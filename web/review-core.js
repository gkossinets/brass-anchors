// Pure helpers for the review page. No DOM, so it runs under `node --test`.

export const STATUSES = ["unreviewed", "approved", "needs_fix", "rejected"];

/** Seconds as HH:MM:SS, with tenths only when they aren't zero. */
export function formatTime(seconds) {
  const tenths = Math.round(seconds * 10);
  const h = Math.floor(tenths / 36000);
  const m = Math.floor((tenths % 36000) / 600);
  const s = (tenths % 600) / 10;
  const pad = (n) => String(Math.floor(n)).padStart(2, "0");
  const sec = Number.isInteger(s) ? pad(s) : `${pad(s)}.${Math.round((s % 1) * 10)}`;
  return `${pad(h)}:${pad(m)}:${sec}`;
}

/** Inverse of formatTime; accepts HH:MM:SS(.s), MM:SS, or plain seconds like the pipeline. */
export function parseTime(text) {
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(text.trim())) return NaN;
  return text.trim().split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

/** Where a playback position in the context audio sits in the source video, to tenths. */
export function sourceTime(windowStart, position) {
  return Math.round((windowStart + position) * 10) / 10;
}

/** Fields whose (trimmed) form value differs from the stored row. */
export function changedFields(row, form) {
  const changes = {};
  for (const [key, value] of Object.entries(form)) {
    const next = String(value).trim();
    if (next !== String(row[key] ?? "").trim()) changes[key] = next;
  }
  return changes;
}

/** Clips per review status; blank status counts as unreviewed. */
export function statusCounts(clips) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const c of clips) counts[c.review_status || "unreviewed"] += 1;
  return counts;
}
