// POST /api/log: store one game event in D1 (binding DB). See server/collect-core.js for the checks.
import { MAX_BODY_BYTES, parseEvent } from "../../server/collect-core.js";

export async function onRequestPost({ request, env }) {
  // Refuse oversized bodies before reading them, when the client says how big they are.
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BODY_BYTES) return new Response("too large", { status: 413 });

  const result = parseEvent(await request.text());
  if (!result.ok) {
    console.warn(`rejected event: ${result.error}`);
    return new Response(result.error, { status: 400 });
  }
  const r = result.row;
  await env.DB.prepare(
    "INSERT INTO events (kind, player, game, mode, round, payload) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(r.kind, r.player, r.game, r.mode, r.round, r.payload).run();
  return new Response(null, { status: 204 });
}
