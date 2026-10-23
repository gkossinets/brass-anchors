// Live spectrogram of the shared <audio> element, drawn left to right so the
// whole clip fills the canvas. The math lives in spectrogram-math.js.
import { rowForFrequency, rowBinRanges, spectrumToColumn, buildPalette, columnForTime } from "./spectrogram-math.js";

// Low enough for the lowest male fundamentals, high enough to show several
// harmonics moving together (that's where the eye picks up the intonation).
const F_MIN = 60;
const F_MAX = 3000;
const GRID_HZ = [100, 200, 500, 1000, 2000];
// Clips are normalized to -23 LUFS, so harmonics sit roughly in this range.
const MIN_DB = -95;
const MAX_DB = -25;

const palette = buildPalette();
let audioContext = null;
let analyser = null;
let unavailable = false;
let currentRun = 0;

/**
 * Route the audio element through an analyser, once. After this the element
 * is only audible through the AudioContext, so it must be resumed on a click.
 */
function connect(audio) {
  if (analyser || unavailable) return analyser;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    audioContext = new Context();
    const source = audioContext.createMediaElementSource(audio);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 4096; // ~12 Hz bins at 48 kHz: resolves harmonics of low voices
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = MIN_DB;
    analyser.maxDecibels = MAX_DB;
    source.connect(analyser);
    analyser.connect(audioContext.destination);
  } catch (err) {
    unavailable = true;
    console.warn(`Spectrogram unavailable: ${err.message}`);
  }
  return analyser;
}

function sizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
}

function addGrid(canvas) {
  const box = canvas.parentElement;
  if (box.querySelector(".tick")) return;
  for (const hz of GRID_HZ) {
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.style.top = `${(100 * rowForFrequency(hz, 1000, F_MIN, F_MAX)) / 999}%`;
    tick.textContent = hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
    box.append(tick);
  }
}

/** Blank the canvas (new round or new clip). */
export function clearSpectrogram(canvas) {
  if (!canvas) return;
  addGrid(canvas);
  sizeCanvas(canvas);
  const g = canvas.getContext("2d");
  const [r, gr, b] = palette[0];
  g.fillStyle = `rgb(${r},${gr},${b})`;
  g.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Start drawing what the audio element plays onto the canvas. Call from the
 * Play click handler, before audio.play(), so the AudioContext can start.
 */
export function startSpectrogram(canvas, audio) {
  const run = ++currentRun;
  clearSpectrogram(canvas);
  if (!connect(audio)) {
    canvas.parentElement.hidden = true;
    return;
  }
  audioContext.resume();

  const { width, height } = canvas;
  const g = canvas.getContext("2d");
  const ranges = rowBinRanges(height, F_MIN, F_MAX, audioContext.sampleRate, analyser.frequencyBinCount);
  const spectrum = new Uint8Array(analyser.frequencyBinCount);
  const column = g.createImageData(1, height);
  let lastX = -1;
  let started = false;

  const frame = () => {
    // A newer clip has taken over this canvas, or playback has stopped.
    if (run !== currentRun || audio.error) return;
    if (!audio.paused) started = true;
    if (started && (audio.paused || audio.ended)) return;
    if (started) {
      analyser.getByteFrequencyData(spectrum);
      const values = spectrumToColumn(spectrum, ranges);
      for (let row = 0; row < height; row++) {
        const [r, gr, b] = palette[values[row]];
        const i = row * 4;
        column.data[i] = r;
        column.data[i + 1] = gr;
        column.data[i + 2] = b;
        column.data[i + 3] = 255;
      }
      // Fill every column since the last frame so fast clips leave no gaps.
      const x = columnForTime(audio.currentTime, audio.duration, width);
      for (let xi = lastX + 1; xi <= x; xi++) g.putImageData(column, xi, 0);
      lastX = Math.max(lastX, x);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
