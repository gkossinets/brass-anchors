#!/usr/bin/env python3
"""Convert raw clips to mono 22.05 kHz, fade the edges, and loudness-normalize."""

import argparse
import sys
from pathlib import Path

import librosa
import numpy as np
import pyloudnorm as pyln
import soundfile as sf

from pipeline.clips import load_clips, parse_timestamp
from pipeline.config import CLIPS_CSV, FADE_MS, ORIGINAL_DIR, RAW_DIR, SAMPLE_RATE, TARGET_LUFS


DURATION_TOLERANCE_SECONDS = 0.5


def duration_problem(actual: float, expected: float) -> str | None:
    """Describe a mismatch between the downloaded length and the CSV section, if any."""
    if abs(actual - expected) <= DURATION_TOLERANCE_SECONDS:
        return None
    return f"duration {actual:.1f}s but clips.csv section is {expected:.1f}s"


def apply_fades(audio: np.ndarray, sr: int, fade_ms: float) -> np.ndarray:
    """Linear fade-in and fade-out so clips never start or stop with a click."""
    n = min(int(sr * fade_ms / 1000), len(audio) // 2)
    out = audio.copy()
    ramp = np.linspace(0.0, 1.0, n)
    out[:n] *= ramp
    out[len(out) - n:] *= ramp[::-1]
    return out


def normalize_loudness(audio: np.ndarray, sr: int, target_lufs: float) -> np.ndarray:
    """Scale to integrated loudness target_lufs, then hard-limit the peak to 1.0.

    The limiter only bites on unusually peaky clips; it's reported so a
    clipped clip is never silently shipped.
    """
    loudness = pyln.Meter(sr).integrated_loudness(audio)
    out = audio * 10 ** ((target_lufs - loudness) / 20)
    peak = np.max(np.abs(out))
    if peak > 1.0:
        print(f"  warning: peak {peak:.2f} after normalization; scaling down", file=sys.stderr)
        out = out / peak
    return out


def prepare_audio(
    audio: np.ndarray, sr: int, target_sr: int, target_lufs: float, fade_ms: float,
) -> tuple[np.ndarray, int]:
    """Mono-mix, resample, fade, and normalize one clip.

    Args:
        audio: Samples, shape (n,) or (n, channels).
        sr: Input sample rate.
        target_sr: Output sample rate.
        target_lufs: Integrated loudness target.
        fade_ms: Fade length at each end.

    Returns:
        (processed mono samples, target_sr)
    """
    mono = audio.mean(axis=1) if audio.ndim == 2 else audio
    mono = librosa.resample(mono.astype(np.float64), orig_sr=sr, target_sr=target_sr)
    mono = apply_fades(mono, target_sr, fade_ms)
    return normalize_loudness(mono, target_sr, target_lufs), target_sr


def main() -> int:
    """Process every raw/*.wav that lacks a processed/original counterpart."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-f", "--force", action="store_true", help="reprocess existing outputs")
    args = parser.parse_args()

    expected = {c.id: parse_timestamp(c.end) - parse_timestamp(c.start) for c in load_clips(CLIPS_CSV)}
    ORIGINAL_DIR.mkdir(parents=True, exist_ok=True)
    for src in sorted(RAW_DIR.glob("*.wav")):
        dst = ORIGINAL_DIR / src.name
        if dst.exists() and not args.force:
            continue
        print(f"normalize {src.stem}", file=sys.stderr)
        audio, sr = sf.read(src)
        if src.stem in expected and (problem := duration_problem(len(audio) / sr, expected[src.stem])):
            print(f"  warning: {src.stem}: {problem}", file=sys.stderr)
        out, out_sr = prepare_audio(audio, sr, SAMPLE_RATE, TARGET_LUFS, FADE_MS)
        sf.write(dst, out, out_sr, subtype="PCM_16")
    return 0


if __name__ == "__main__":
    sys.exit(main())
