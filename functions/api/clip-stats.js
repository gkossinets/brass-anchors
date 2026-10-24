// GET /api/clip-stats: each game's hardest clips, for web/clips.html. See server/clip-stats-core.js.
import { clipDifficulty } from "../../server/clip-stats-core.js";

export async function onRequestGet({ env }) {
  // Reads the whole table, as /api/stats does; fine at this scale.
  const { results } = await env.DB.prepare(
    "SELECT kind, player, game, mode, round, received_at, payload FROM events",
  ).all();
  return Response.json(clipDifficulty(results), {
    // A minute's staleness is fine, and it spares the database a query per page view.
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
