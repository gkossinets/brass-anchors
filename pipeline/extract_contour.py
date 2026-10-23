#!/usr/bin/env python3
"""Extract f0, voicing strength, and an RMS loudness envelope per clip.

Writes processed/contours/<id>.npz and a spectrogram + f0 diagnostic PNG.
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import parselmouth
import soundfile as sf

from pipeline.clips import load_clips
from pipeline.config import CLIPS_CSV, CONTOUR_DIR, DEFAULT_PITCH_RANGE, DIAGNOSTIC_DIR, HOP_SECONDS, ORIGINAL_DIR, PROCESSED_DIR
from pipeline.synth import TIMBRES

RMS_WINDOW_SECONDS = 0.03
SMOOTH_WIDTH = 5


def _voiced_runs(f0: np.ndarray) -> list[tuple[int, int]]:
    """Half-open [start, end) index ranges of consecutive non-NaN frames."""
    voiced = ~np.isnan(f0)
    edges = np.diff(np.concatenate([[0], voiced.astype(int), [0]]))
    return list(zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)))


def median_smooth_voiced(f0: np.ndarray, width: int = SMOOTH_WIDTH) -> np.ndarray:
    """Median-filter f0 within each voiced run only.

    Filtering never reaches across an unvoiced gap, because those silences are
    part of the speaker's cadence and must stay intact.
    """
    out = f0.copy()
    half = width // 2
    for start, end in _voiced_runs(f0):
        run = f0[start:end]
        for i in range(len(run)):
            out[start + i] = np.median(run[max(0, i - half):i + half + 1])
    return out


FLAT_MIN_SECONDS = 0.3
FLAT_MAX_CENTS = 10.0


def flat_pitch_runs(f0: np.ndarray, hop: float = HOP_SECONDS) -> list[tuple[float, float]]:
    """Find stretches where pitch holds dead steady, which speech never does.

    Censor bleeps, test tones, and music stings show up this way; resynthesized,
    they become a long steady note that gives the clip away.

    Returns:
        (start, end) times in seconds, end exclusive, rounded to 0.01 s.
    """
    runs = []
    min_frames = int(round(FLAT_MIN_SECONDS / hop))
    for start, end in _voiced_runs(f0):
        i = start
        while i < end:
            j = i + 1
            while j < end and abs(1200 * np.log2(f0[j] / f0[i])) < FLAT_MAX_CENTS:
                j += 1
            if j - i >= min_frames:
                runs.append((round(i * hop, 2), round(j * hop, 2)))
            i = j
    return runs


def rms_db_envelope(audio: np.ndarray, sr: int, times: np.ndarray, window: float = RMS_WINDOW_SECONDS) -> np.ndarray:
    """Short-time RMS in dBFS, sampled at the given frame times."""
    n = max(1, int(window * sr))
    mean_sq = np.convolve(audio.astype(np.float64) ** 2, np.ones(n) / n, mode="same")
    idx = np.clip(np.round(times * sr).astype(int), 0, len(audio) - 1)
    return 10 * np.log10(mean_sq[idx] + 1e-12)


def extract_contour(audio: np.ndarray, sr: int, floor: float, ceiling: float) -> dict[str, np.ndarray]:
    """Pitch-track one clip on a uniform 10 ms grid starting at t=0.

    Args:
        audio: Mono samples.
        sr: Sample rate.
        floor: Pitch floor in Hz.
        ceiling: Pitch ceiling in Hz.

    Returns:
        Dict with 'time', 'f0' (Hz, NaN where unvoiced), 'voicing' (Praat
        strength, 0 where unvoiced), and 'rms_db'.
    """
    pitch = parselmouth.Sound(audio.astype(np.float64), sampling_frequency=sr).to_pitch_ac(
        time_step=HOP_SECONDS, pitch_floor=floor, pitch_ceiling=ceiling,
    )
    raw_f0 = pitch.selected_array["frequency"]
    raw_strength = pitch.selected_array["strength"]

    times = np.arange(0, len(audio) / sr, HOP_SECONDS)
    # Praat's frames start at an offset; map our grid onto its nearest frame.
    idx = np.round((times - pitch.x1) / pitch.dx).astype(int)
    inside = (idx >= 0) & (idx < len(raw_f0))
    f0 = np.full(len(times), np.nan)
    voicing = np.zeros(len(times))
    f0[inside] = raw_f0[idx[inside]]
    voicing[inside] = raw_strength[idx[inside]]
    unvoiced = ~(f0 > 0)
    f0[unvoiced] = np.nan
    voicing[unvoiced] = 0.0

    return {
        "time": times,
        "f0": median_smooth_voiced(f0),
        "voicing": voicing,
        "rms_db": rms_db_envelope(audio, sr, times),
    }


def save_contour(path: Path, contour: dict[str, np.ndarray], pitch_range: tuple[float, float]) -> None:
    """Save a contour with the pitch range it was tracked with, so a range change is detectable."""
    np.savez(path, **contour, pitch_range=np.array(pitch_range, dtype=float))


def contour_is_current(path: Path, pitch_range: tuple[float, float]) -> bool:
    """Whether a saved contour exists and was tracked with this pitch range.

    Contours saved before ranges were recorded count as stale.
    """
    if not path.exists():
        return False
    with np.load(path) as saved:
        return "pitch_range" in saved and np.allclose(saved["pitch_range"], pitch_range)


def save_diagnostic(audio: np.ndarray, sr: int, contour: dict[str, np.ndarray], title: str, path: Path) -> None:
    """Spectrogram with the f0 track overlaid, for eyeballing octave errors."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, (ax_spec, ax_rms) = plt.subplots(2, 1, figsize=(14, 6), sharex=True, height_ratios=[3, 1])
    with np.errstate(divide="ignore"):  # exact digital silence in fades
        ax_spec.specgram(audio, NFFT=1024, Fs=sr, noverlap=768, cmap="magma", vmin=-120)
    ax_spec.plot(contour["time"], contour["f0"], color="cyan", lw=1.5)
    ax_spec.set_ylim(0, 1000)
    ax_spec.set_ylabel("Hz")
    ax_spec.set_title(title)
    ax_rms.plot(contour["time"], contour["rms_db"], color="k", lw=0.8)
    ax_rms.set_ylabel("RMS dB")
    ax_rms.set_xlabel("s")
    fig.tight_layout()
    fig.savefig(path, dpi=80)
    plt.close(fig)


def main() -> int:
    """Extract contours for every normalized original lacking one."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-f", "--force", action="store_true", help="recompute existing contours")
    args = parser.parse_args()

    ranges = {c.id: c.pitch_range for c in load_clips(CLIPS_CSV)} if CLIPS_CSV.exists() else {}
    CONTOUR_DIR.mkdir(parents=True, exist_ok=True)
    DIAGNOSTIC_DIR.mkdir(parents=True, exist_ok=True)

    for src in sorted(ORIGINAL_DIR.glob("*.wav")):
        dst = CONTOUR_DIR / f"{src.stem}.npz"
        if src.stem not in ranges:
            print(f"  warning: {src.stem} not in clips.csv; using default pitch range", file=sys.stderr)
        floor, ceiling = ranges.get(src.stem, DEFAULT_PITCH_RANGE)
        if contour_is_current(dst, (floor, ceiling)) and not args.force:
            continue
        audio, sr = sf.read(src)
        contour = extract_contour(audio, sr, floor, ceiling)
        voiced_pct = 100 * np.mean(~np.isnan(contour["f0"]))
        print(f"contour {src.stem}: {voiced_pct:.0f}% voiced, median f0 {np.nanmedian(contour['f0']):.0f} Hz", file=sys.stderr)
        for start, end in flat_pitch_runs(contour["f0"]):
            print(f"  warning: {src.stem}: steady tone {start:.2f}-{end:.2f}s (censor bleep? music?)", file=sys.stderr)
        save_contour(dst, contour, (floor, ceiling))
        # Renders made from the old contour are stale now; the synth stage remakes them.
        for timbre in TIMBRES:
            (PROCESSED_DIR / timbre / f"{src.stem}.wav").unlink(missing_ok=True)
        save_diagnostic(audio, sr, contour, f"{src.stem}  ({floor:.0f}-{ceiling:.0f} Hz)", DIAGNOSTIC_DIR / f"{src.stem}.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
