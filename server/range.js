// HTTP Range support for audio served from Cloudflare Pages, which answers Range
// requests with the whole file (200). Safari opens <audio> with a "bytes=0-1" probe
// and may not play from a server that ignores it. Pure, so it runs under `node --test`.

const SINGLE = /^bytes=(\d*)-(\d*)$/;

/**
 * The byte span a Range header asks for in a file of `size` bytes.
 *
 * @returns {{start: number, end: number} | null | "unsatisfiable"} null means send the whole file.
 */
export function parseRange(header, size) {
  const m = SINGLE.exec((header ?? "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start, end;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2])); // suffix: the last N bytes
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? "unsatisfiable" : { start, end };
}

/** Turn a full asset response into the response a Range request should get. */
export async function withRange(rangeHeader, asset) {
  if (!asset.ok) return asset;
  const headers = new Headers(asset.headers);
  headers.set("Accept-Ranges", "bytes");
  const body = await asset.arrayBuffer();
  const span = parseRange(rangeHeader, body.byteLength);
  if (span === null) return new Response(body, { status: 200, headers });
  if (span === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${body.byteLength}` } });
  }
  headers.set("Content-Range", `bytes ${span.start}-${span.end}/${body.byteLength}`);
  headers.set("Content-Length", String(span.end - span.start + 1));
  return new Response(body.slice(span.start, span.end + 1), { status: 206, headers });
}
