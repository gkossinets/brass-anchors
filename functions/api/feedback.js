// POST /api/feedback: store one message from the feedback form. See server/feedback-core.js.
import { parseFeedback } from "../../server/feedback-core.js";

// Room for a full-length message plus JSON overhead; anything bigger isn't from the form.
const MAX_BODY_BYTES = 16 * 1024;

export async function onRequestPost({ request, env }) {
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) return new Response("too large", { status: 413 });
  const result = parseFeedback(await request.text());
  if (!result.ok) return new Response(result.error, { status: 400 });
  if (!result.spam) {
    await env.DB.prepare("INSERT INTO feedback (page, message) VALUES (?, ?)").bind(result.row.page, result.row.message).run();
  }
  return new Response(null, { status: 204 });
}
