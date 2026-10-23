"""Speech statistics for a clip, from its pitch and loudness contour.

Shown as "stats for geeks" on the match-mode reveal. All thresholds are
relative to the clip's own speech level, because background noise differs a
lot between recordings (a 1970s tape vs a 2020s studio).
"""

import numpy as np
from scipy.signal import find_peaks

from pipeline.config import HOP_SECONDS

# Loud speech level = this percentile of frame loudness.
SPEECH_LEVEL_PERCENTILE = 90
# Quieter than speech level by this much (and unvoiced) = silence.
QUIET_BELOW_SPEECH_DB = 15.0
# Silences shorter than this are consonants or breaths inside a phrase, not pauses.
MIN_PAUSE_SECONDS = 0.2
# Syllable nuclei: voiced loudness peaks standing this far above the dips around them,
# no more than this far below speech level, and at least this far apart.
# Tuned (2026-10-22) against transcript syllable counts of the 20 clips; the
# estimate is rough (rate correlation ~0.6 with the transcript counts at best).
SYLLABLE_PROMINENCE_DB = 4.0
SYLLABLE_FLOOR_BELOW_SPEECH_DB = 20.0
MIN_SYLLABLE_GAP_SECONDS = 0.07
# The detector misses about 1 syllable in 5 (merged unstressed syllables), so the
# reported rate is scaled up by this factor, fitted on the same transcripts.
SYLLABLE_CALIBRATION = 1.25


def pitch_stats(f0: np.ndarray) -> dict:
    """Median pitch (Hz), plus range and spread in semitones.

    The range runs from the 5th to the 95th percentile, so a few octave errors
    in the pitch track can't inflate it.
    """
    voiced = f0[~np.isnan(f0)]
    if len(voiced) == 0:
        return {"median_hz": None, "range_st": None, "sd_st": None}
    median = float(np.median(voiced))
    semitones = 12 * np.log2(voiced / median)
    p5, p95 = np.percentile(semitones, [5, 95])
    return {"median_hz": median, "range_st": float(p95 - p5), "sd_st": float(np.std(semitones))}


def _quiet_runs(contour: dict) -> list[tuple[int, int]]:
    """Half-open frame ranges that are unvoiced and well below the clip's speech level."""
    rms = contour["rms_db"]
    level = np.percentile(rms, SPEECH_LEVEL_PERCENTILE)
    quiet = np.isnan(contour["f0"]) & (rms < level - QUIET_BELOW_SPEECH_DB)
    edges = np.diff(np.concatenate([[0], quiet.astype(int), [0]]))
    return list(zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)))


def _edge_frames(contour: dict) -> int:
    """Frames of silence at the very start and end of the clip (cut points, not pauses)."""
    n = len(contour["rms_db"])
    return sum(end - start for start, end in _quiet_runs(contour) if start == 0 or end == n)


def pause_runs(contour: dict, hop: float = HOP_SECONDS) -> list[float]:
    """Durations (s) of pauses inside the clip: long, quiet, unvoiced stretches."""
    n = len(contour["rms_db"])
    return [(end - start) * hop for start, end in _quiet_runs(contour)
            if start > 0 and end < n and (end - start) * hop >= MIN_PAUSE_SECONDS]


def syllable_peaks(contour: dict, hop: float = HOP_SECONDS) -> np.ndarray:
    """Frame indices of estimated syllable nuclei: prominent loudness peaks in voiced frames."""
    rms = contour["rms_db"]
    level = np.percentile(rms, SPEECH_LEVEL_PERCENTILE)
    peaks, _ = find_peaks(rms, height=level - SYLLABLE_FLOOR_BELOW_SPEECH_DB, prominence=SYLLABLE_PROMINENCE_DB,
                          distance=max(1, int(round(MIN_SYLLABLE_GAP_SECONDS / hop))))
    return peaks[~np.isnan(contour["f0"][peaks])]


def clip_stats(contour: dict, hop: float = HOP_SECONDS) -> dict:
    """All the stats for one clip, unrounded; None where a value can't be computed.

    Speech rate is a rough estimate of syllables per second of speaking time
    (pauses and the silence at the clip's edges excluded), so it measures how
    fast someone talks rather than how much they pause.
    """
    duration = len(contour["rms_db"]) * hop
    pauses = pause_runs(contour, hop)
    within = duration - _edge_frames(contour) * hop
    speaking = within - sum(pauses)
    voiced = not np.all(np.isnan(contour["f0"]))
    return {
        **pitch_stats(contour["f0"]),
        "syllables_per_s": (SYLLABLE_CALIBRATION * len(syllable_peaks(contour, hop)) / speaking
                            if voiced and speaking > 0 else None),
        "pauses": len(pauses),
        # Per minute of the clip (edges excluded), so clips of different lengths compare fairly.
        "pauses_per_min": 60 * len(pauses) / within if within > 0 else 0,
        "mean_pause_s": float(np.mean(pauses)) if pauses else None,
        "pause_pct": 100 * sum(pauses) / within if within > 0 else 0,
        "duration_s": duration,
    }
