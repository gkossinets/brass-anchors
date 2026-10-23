// Pure helpers for the spectrogram: axis mapping, column extraction, colours.
// No DOM or Web Audio here, so it runs under `node --test`.

/** Canvas row (0 = top) for a frequency on a log axis from fMin (bottom) to fMax (top). */
export function rowForFrequency(freq, height, fMin, fMax) {
  const frac = Math.log(freq / fMin) / Math.log(fMax / fMin);
  const row = Math.round((1 - frac) * (height - 1));
  return Math.min(height - 1, Math.max(0, row));
}

/**
 * For each canvas row, the [lo, hi] range of analyser bins it covers.
 * Low rows span a fraction of a bin (several rows share one); high rows span
 * many bins, so a column takes the loudest bin in each range.
 */
export function rowBinRanges(height, fMin, fMax, sampleRate, binCount) {
  const binHz = sampleRate / (2 * binCount);
  const ratio = fMax / fMin;
  const freqAt = (rowFromBottom) =>
    Math.min(fMax, Math.max(fMin, fMin * ratio ** (rowFromBottom / (height - 1))));
  const ranges = [];
  for (let row = 0; row < height; row++) {
    const fromBottom = height - 1 - row;
    const lo = Math.min(binCount - 1, Math.round(freqAt(fromBottom - 0.5) / binHz));
    const hi = Math.min(binCount - 1, Math.max(lo, Math.round(freqAt(fromBottom + 0.5) / binHz)));
    ranges.push([lo, hi]);
  }
  return ranges;
}

/** One pixel column: the loudest analyser value within each row's bin range. */
export function spectrumToColumn(spectrum, ranges) {
  const column = new Uint8Array(ranges.length);
  ranges.forEach(([lo, hi], row) => {
    let max = 0;
    for (let b = lo; b <= hi; b++) if (spectrum[b] > max) max = spectrum[b];
    column[row] = max;
  });
  return column;
}

// Magma-like stops: perceptually ordered from near-black to pale yellow, so
// louder always reads brighter.
const STOPS = [
  [0, 0, 4], [59, 15, 112], [140, 41, 129], [222, 73, 104], [254, 159, 109], [252, 253, 191],
];

/** 256 [r, g, b] entries indexed by analyser byte value. */
export function buildPalette() {
  const palette = [];
  for (let i = 0; i < 256; i++) {
    const pos = (i / 255) * (STOPS.length - 1);
    const k = Math.min(STOPS.length - 2, Math.floor(pos));
    const t = pos - k;
    palette.push(STOPS[k].map((c, j) => Math.round(c + (STOPS[k + 1][j] - c) * t)));
  }
  return palette;
}

/** x position for a playback time; the whole clip spans the canvas width. */
export function columnForTime(time, duration, width) {
  if (!(duration > 0)) return 0;
  return Math.min(width - 1, Math.floor((time / duration) * width));
}
