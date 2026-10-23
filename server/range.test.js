import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRange, withRange } from "./range.js";

test("parseRange handles start-end, open-ended, and suffix ranges", () => {
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=0-1", 1000), { start: 0, end: 1 });       // Safari's first probe
  assert.deepEqual(parseRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=950-5000", 1000), { start: 950, end: 999 }); // clipped to the file
});

test("parseRange: no usable range means the whole file; impossible ones are unsatisfiable", () => {
  assert.equal(parseRange(null, 1000), null);
  assert.equal(parseRange("items=0-5", 1000), null);
  assert.equal(parseRange("bytes=0-5,10-20", 1000), null); // multipart: send it all
  assert.equal(parseRange("bytes=1000-", 1000), "unsatisfiable");
  assert.equal(parseRange("bytes=50-10", 1000), "unsatisfiable");
});

const asset = (bytes, headers = {}) =>
  new Response(bytes, { status: 200, headers: { "Content-Type": "audio/mpeg", ETag: '"abc"', ...headers } });

test("withRange returns 206 with exactly the requested bytes and keeps the asset's headers", async () => {
  const bytes = new Uint8Array(1000).map((_, i) => i % 256);
  const r = await withRange("bytes=10-19", asset(bytes));
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("Content-Range"), "bytes 10-19/1000");
  assert.equal(r.headers.get("Content-Length"), "10");
  assert.equal(r.headers.get("Content-Type"), "audio/mpeg");
  assert.equal(r.headers.get("ETag"), '"abc"');
  assert.equal(r.headers.get("Accept-Ranges"), "bytes");
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [...bytes.slice(10, 20)]);
});

test("withRange without a Range header passes the whole file through, advertising ranges", async () => {
  const r = await withRange(null, asset(new Uint8Array(50)));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Accept-Ranges"), "bytes");
  assert.equal((await r.arrayBuffer()).byteLength, 50);
});

test("withRange answers 416 for an impossible range and leaves errors alone", async () => {
  const r = await withRange("bytes=5000-", asset(new Uint8Array(50)));
  assert.equal(r.status, 416);
  assert.equal(r.headers.get("Content-Range"), "bytes */50");
  const missing = await withRange("bytes=0-1", new Response("not found", { status: 404 }));
  assert.equal(missing.status, 404);
});
