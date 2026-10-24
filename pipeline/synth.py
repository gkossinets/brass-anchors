#!/usr/bin/env python3
"""Resynthesize each clip's pitch and loudness contour in several timbres.

All timbres share one additive engine: harmonics of the (possibly transposed)
f0, a source spectral slope that brightens with loudness, and an optional
fixed resonance envelope (vowel formants, or the peaks of an instrument
body) that the harmonics move through as the pitch changes, the way a real voice keeps its
vowel while its pitch glides.
"""

import argparse
import sys
from dataclasses import dataclass

import numpy as np
import soundfile as sf

from pipeline.config import CONTOUR_DIR, PROCESSED_DIR, SAMPLE_RATE, TARGET_LUFS
from pipeline.trim_normalize import apply_fades, normalize_loudness

DEFAULT_GATE_DB = -50.0
# rms_db range (on -23 LUFS-normalized input) mapped onto dark..bright source slope
BRIGHTNESS_DB_RANGE = (-45.0, -15.0)
# harmonics fade out over this band below the timbre's top frequency, so a
# glide never switches a harmonic on or off abruptly
HARMONIC_TAPER_HZ = 500.0


@dataclass(frozen=True)
class Timbre:
    """Parameters for one synthesized instrument.

    Harmonic n has amplitude n**-slope times the resonance gain at its
    frequency; slope moves from dark_slope to bright_slope as loudness rises.
    Voices use cascaded `formants` (which also roll the spectrum off above
    the top formant, as a vocal tract does); instruments use `body` peaks on a
    flat baseline, which keep their upper harmonics.
    """

    name: str
    label: str
    transpose_semitones: float
    dark_slope: float
    bright_slope: float
    formants: tuple[tuple[float, float], ...] = ()  # (centre Hz, bandwidth Hz), cascaded
    body: tuple[tuple[float, float, float], ...] = ()  # (centre Hz, bandwidth Hz, peak gain)
    max_harmonics: int = 200
    max_freq: float = 5000.0
    ramp_seconds: float = 0.008


# Order matters: the game starts on the first timbre. Trombone fits male voices
# at true pitch; hum is a backup. (A cello preset was tried and dropped after
# listening; the octave-up trumpet went unused and was dropped so the switch
# fits on one line on a phone.)
TIMBRES: dict[str, Timbre] = {
    # Brass source with a wide dark-to-bright swing (soft = mellow, loud = brassy);
    # broad bell/mouthpiece resonances.
    "trombone": Timbre("trombone", "Trombone", 0, dark_slope=2.4, bright_slope=0.9,
                       body=((500, 350, 2.5), (1100, 700, 2.0)),
                       ramp_seconds=0.015),
    # Neutral vowel (schwa-like) on a glottal-ish source: hummed speech melody.
    "hum": Timbre("hum", "Hum (voice)", 0, dark_slope=1.6, bright_slope=0.9,
                  formants=((500, 80), (1500, 100), (2500, 140), (3500, 200)),
                  ramp_seconds=0.015),
}


def resonance_gain(freqs: np.ndarray, formants: tuple[tuple[float, float], ...] | list) -> np.ndarray:
    """Magnitude of cascaded second-order resonators, normalized to 1 at 0 Hz.

    Each resonator peaks near its centre frequency with gain about centre/bandwidth
    and rolls off at 12 dB/octave above it (the Klatt cascade formant model).
    """
    gain = np.ones_like(freqs, dtype=float)
    for centre, bandwidth in formants:
        gain *= centre**2 / np.sqrt((centre**2 - freqs**2) ** 2 + (bandwidth * freqs) ** 2)
    return gain


def peak_gain(freqs: np.ndarray, peaks: tuple[tuple[float, float, float], ...] | list) -> np.ndarray:
    """Flat gain of 1 with Lorentzian bumps reaching `gain` at each peak centre."""
    out = np.ones_like(freqs, dtype=float)
    for centre, bandwidth, gain in peaks:
        out += (gain - 1.0) / (1.0 + ((freqs - centre) / (bandwidth / 2)) ** 2)
    return out


def _frames_to_samples(values: np.ndarray, frame_times: np.ndarray, n_samples: int, sr: int) -> np.ndarray:
    return np.interp(np.arange(n_samples) / sr, frame_times, values)


def _hold_through_gaps(f0: np.ndarray) -> np.ndarray:
    """Fill NaNs with the previous voiced value (or the first one) so the
    oscillator phase stays continuous; the amplitude gate silences these spans."""
    out = f0.copy()
    voiced = np.flatnonzero(~np.isnan(out))
    if len(voiced) == 0:
        return np.zeros_like(out)
    out[:voiced[0]] = out[voiced[0]]
    for i in range(voiced[0] + 1, len(out)):
        if np.isnan(out[i]):
            out[i] = out[i - 1]
    return out


def _causal_ramp(gate: np.ndarray, sr: int, seconds: float) -> np.ndarray:
    """Smooth a 0/1 gate with a causal box filter: onsets ramp up starting at
    the onset rather than leaking sound into the preceding silence."""
    n = max(1, int(seconds * sr))
    return np.convolve(gate, np.ones(n) / n, mode="full")[:len(gate)]


def synthesize(
    contour: dict[str, np.ndarray],
    sr: int,
    timbre: Timbre,
    gate_db: float = DEFAULT_GATE_DB,
) -> np.ndarray:
    """Render a pitch/loudness contour in the given timbre.

    Args:
        contour: Dict with 'time', 'f0' (Hz, NaN unvoiced), and 'rms_db' arrays.
        sr: Output sample rate.
        timbre: Instrument parameters.
        gate_db: Frames quieter than this are silent.

    Returns:
        Mono samples (not loudness-normalized).
    """
    times, f0, rms_db = contour["time"], contour["f0"], contour["rms_db"]
    hop = times[1] - times[0]
    n_samples = int(round((times[-1] + hop) * sr))

    gate_frames = (~np.isnan(f0) & (rms_db > gate_db)).astype(float)
    step = np.clip((np.arange(n_samples) / sr / hop).astype(int), 0, len(times) - 1)
    gate = _causal_ramp(gate_frames[step], sr, timbre.ramp_seconds)

    freq = _frames_to_samples(_hold_through_gaps(f0), times, n_samples, sr) * 2 ** (timbre.transpose_semitones / 12)
    level_db = _frames_to_samples(rms_db, times, n_samples, sr)
    amplitude = 10 ** (level_db / 20) * gate

    lo, hi = BRIGHTNESS_DB_RANGE
    brightness = np.clip((level_db - lo) / (hi - lo), 0.0, 1.0)
    slope = timbre.dark_slope + (timbre.bright_slope - timbre.dark_slope) * brightness

    top = min(timbre.max_freq, 0.45 * sr)
    lowest = max(np.min(freq[gate > 0]) if np.any(gate > 0) else top, 1.0)
    n_harmonics = int(min(timbre.max_harmonics, top // lowest))

    phase = 2 * np.pi * np.cumsum(freq) / sr
    tone = np.zeros(n_samples)
    for n in range(1, n_harmonics + 1):
        hf = n * freq
        taper = np.clip((top - hf) / HARMONIC_TAPER_HZ, 0.0, 1.0)
        if not np.any(taper > 0):
            break
        weight = taper * n ** (-slope)
        if timbre.formants:
            weight = weight * resonance_gain(hf, timbre.formants)
        if timbre.body:
            weight = weight * peak_gain(hf, timbre.body)
        tone += weight * np.sin(n * phase)
    return amplitude * tone


def main() -> int:
    """Render every contour in every timbre that lacks an output WAV."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-f", "--force", action="store_true", help="re-render existing outputs")
    parser.add_argument("-t", "--timbre", choices=sorted(TIMBRES), action="append",
                        help="render only this timbre (repeatable); default all")
    args = parser.parse_args()

    for name in args.timbre or TIMBRES:
        timbre = TIMBRES[name]
        out_dir = PROCESSED_DIR / name
        out_dir.mkdir(parents=True, exist_ok=True)
        for src in sorted(CONTOUR_DIR.glob("*.npz")):
            dst = out_dir / f"{src.stem}.wav"
            if dst.exists() and not args.force:
                continue
            print(f"{name} {src.stem}", file=sys.stderr)
            tone = synthesize(dict(np.load(src)), SAMPLE_RATE, timbre)
            tone = normalize_loudness(apply_fades(tone, SAMPLE_RATE, 20), SAMPLE_RATE, TARGET_LUFS)
            sf.write(dst, tone, SAMPLE_RATE, subtype="PCM_16")
    return 0


if __name__ == "__main__":
    sys.exit(main())
