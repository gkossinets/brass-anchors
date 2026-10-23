// Checks a message from the site's feedback form, and lists stored messages for `make feedback`.
// Pure (no Cloudflare APIs), so it runs under `node --test`.

export const MAX_MESSAGE_CHARS = 2000;
const PAGES = ["front", "results"];

/**
 * Parse and check a feedback request body.
 *
 * The form has a hidden "website" field that people never see; a bot that fills
 * every field is told it succeeded (so it moves on) but nothing is stored.
 *
 * @returns {{ok: true, spam: boolean, row?: {page, message}} | {ok: false, error: string}}
 */
export function parseFeedback(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: "body is not JSON" };
  }
  if (body === null || typeof body !== "object") return { ok: false, error: "body is not an object" };
  if (typeof body.website === "string" && body.website.trim()) return { ok: true, spam: true };
  if (typeof body.message !== "string") return { ok: false, error: "message is not text" };
  const message = body.message.trim();
  if (!message) return { ok: false, error: "message is empty" };
  if (message.length > MAX_MESSAGE_CHARS) return { ok: false, error: `message over ${MAX_MESSAGE_CHARS} characters` };
  const page = PAGES.includes(body.page) ? body.page : "other";
  return { ok: true, spam: false, row: { page, message } };
}

/** Stored messages, oldest first, one per line: "2026-10-23 14:00  front    message". */
export function formatFeedback(rows) {
  if (rows.length === 0) return "No feedback yet.";
  return [...rows]
    .sort((a, b) => a.received_at.localeCompare(b.received_at))
    .map((r) => `${r.received_at.slice(0, 16).replace("T", " ")}  ${r.page.padEnd(7)}  ${r.message.replace(/\s+/g, " ")}`)
    .join("\n");
}
