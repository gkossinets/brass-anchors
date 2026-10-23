// GET /api/stats: everyone's results so far, for web/stats.html. See server/stats-core.js.
import { publicSummary } from "../../server/stats-core.js";

export async function onRequestGet({ env }) {
  // Reads the whole table: fine for a game shared among friends (thousands of rows).
  // If it grows far beyond that, aggregate in SQL or cache a summary instead.
  const { results } = await env.DB.prepare(
    "SELECT kind, player, game, mode, round, received_at, payload FROM events",
  ).all();
  return Response.json(publicSummary(results), {
    // A minute's staleness is fine, and it spares the database a query per page view.
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
