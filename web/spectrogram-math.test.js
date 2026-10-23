import { test } from "node:test";
import assert from "node:assert/strict";
import { rowForFrequency, rowBinRanges, spectrumToColumn, buildPalette, columnForTime } from "./spectrogram-math.js";

const H = 200;
const F_MIN = 60;
const F_MAX = 3000;

test("rows run high frequency at the top to low at the bottom, on a log scale", () => {
  assert.equal(rowForFrequency(F_MAX, H, F_MIN, F_MAX), 0);
  assert.equal(rowForFrequency(F_MIN, H, F_MIN, F_MAX), H - 1);
  const mid = Math.sqrt(F_MIN * F_MAX); // geometric midpoint sits halfway up
  assert.ok(Math.abs(rowForFrequency(mid, H, F_MIN, F_MAX) - (H - 1) / 2) <= 1);
});

test("an octave takes the same height anywhere on the axis", () => {
  const octave = (f) => rowForFrequency(f, H, F_MIN, F_MAX) - rowForFrequency(2 * f, H, F_MIN, F_MAX);
  assert.ok(Math.abs(octave(100) - octave(1000)) <= 1);
});

test("each row covers a non-empty bin range, ordered from high bins at top to low at bottom", () => {
  const sampleRate = 48000;
  const binCount = 2048; // fftSize 4096
  const ranges = rowBinRanges(H, F_MIN, F_MAX, sampleRate, binCount);
  assert.equal(ranges.length, H);
  const binHz = sampleRate / (2 * binCount);
  for (const [lo, hi] of ranges) {
    assert.ok(lo <= hi);
    assert.ok(lo >= 0 && hi < binCount);
  }
  for (let r = 1; r < H; r++) assert.ok(ranges[r][0] <= ranges[r - 1][0]);
  assert.ok(Math.abs(ranges[0][1] * binHz - F_MAX) < 2 * binHz);
  assert.ok(Math.abs(ranges[H - 1][0] * binHz - F_MIN) < 2 * binHz);
});

test("a column takes the loudest bin within each row's range", () => {
  const spectrum = new Uint8Array([0, 10, 200, 30, 5, 0]);
  const column = spectrumToColumn(spectrum, [[4, 5], [1, 3], [0, 0]]);
  assert.deepEqual([...column], [5, 200, 0]);
});

test("palette: 256 RGB entries, dark at silence, bright at full scale, never getting darker", () => {
  const palette = buildPalette();
  assert.equal(palette.length, 256);
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  assert.ok(lum(palette[0]) < 30);
  assert.ok(lum(palette[255]) > 200);
  for (let i = 1; i < 256; i++) assert.ok(lum(palette[i]) >= lum(palette[i - 1]) - 1e-9);
});

test("the whole clip fills the canvas width exactly", () => {
  assert.equal(columnForTime(0, 15, 600), 0);
  assert.equal(columnForTime(7.5, 15, 600), 300);
  assert.equal(columnForTime(15, 15, 600), 599);
  assert.equal(columnForTime(3, NaN, 600), 0, "duration unknown before metadata loads");
});
