// /audio/*: static audio with HTTP Range support, which Pages lacks (see server/range.js).
import { withRange } from "../../server/range.js";

export async function onRequestGet({ request, env }) {
  // Fetch the whole file from the static assets (no Range header), then slice it.
  const asset = await env.ASSETS.fetch(new Request(request.url));
  return withRange(request.headers.get("Range"), asset);
}

export async function onRequestHead(context) {
  const response = await onRequestGet(context);
  return new Response(null, { status: response.status, headers: response.headers });
}
