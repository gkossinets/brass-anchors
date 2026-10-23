import numpy as np
import pytest

from pipeline.stats import SYLLABLE_CALIBRATION, clip_stats, pause_runs, pitch_stats, syllable_peaks

HOP = 0.01


def contour_from(segments: list[tuple[str, float]], syllables_per_s: float = 4.0, f0: float = 120.0) -> dict:
    """Build a contour from ('speech', seconds) / ('silence', seconds) segments.

    Speech is voiced at a steady f0, with loudness bumping once per syllable
    (8 dB dips between syllables); silence is unvoiced and 40 dB down.
    """
    f0s, rms = [], []
    for kind, seconds in segments:
        n = int(round(seconds / HOP))
        t = np.arange(n) * HOP
        if kind == "speech":
            f0s.append(np.full(n, f0))
            # starts in a dip, so every syllable is a proper peak (none sits on the first frame)
            rms.append(-20 - 8 * (0.5 + 0.5 * np.cos(2 * np.pi * syllables_per_s * t)))
        else:
            f0s.append(np.full(n, np.nan))
            rms.append(np.full(n, -60.0))
    f0_all, rms_all = np.concatenate(f0s), np.concatenate(rms)
    return {"time": np.arange(len(f0_all)) * HOP, "f0": f0_all, "rms_db": rms_all}


def test_pitch_stats_use_median_and_robust_semitone_range():
    # f0 spread evenly over one octave (12 semitones) above 100 Hz, with gaps.
    f0 = 100 * 2 ** (np.linspace(0, 12, 1001) / 12)
    f0 = np.concatenate([f0, np.full(200, np.nan)])
    s = pitch_stats(f0)
    assert abs(s["median_hz"] - 100 * 2 ** 0.5) < 1          # 6 semitones up
    assert abs(s["range_st"] - 0.9 * 12) < 0.1               # 5th to 95th percentile
    assert abs(s["sd_st"] - 12 / np.sqrt(12)) < 0.1          # SD of a uniform spread


def test_pitch_range_ignores_a_few_octave_errors():
    f0 = np.full(1000, 120.0)
    f0[:20] = 480.0  # 2% of frames tracked two octaves too high
    assert pitch_stats(f0)["range_st"] < 0.5


def test_pauses_need_to_be_long_and_quiet_and_exclude_clip_edges():
    c = contour_from([("silence", 0.2), ("speech", 1.0), ("silence", 0.1), ("speech", 1.0),
                      ("silence", 0.3), ("speech", 1.0), ("silence", 0.5), ("speech", 1.0), ("silence", 0.3)])
    runs = pause_runs(c)
    assert [round(d, 2) for d in runs] == [0.3, 0.5]  # the 0.1 s gap is too short; edges don't count


def test_syllables_are_loudness_peaks_in_voiced_frames():
    c = contour_from([("speech", 2.0)], syllables_per_s=4.0)
    assert len(syllable_peaks(c)) == 8


def test_clip_stats_rate_excludes_pauses():
    c = contour_from([("speech", 2.0), ("silence", 0.6), ("speech", 2.0)], syllables_per_s=5.0)
    s = clip_stats(c)
    # Raw peaks run 5/s; the reported rate corrects the estimator's measured undercount.
    assert abs(s["syllables_per_s"] - 5.0 * SYLLABLE_CALIBRATION) < 0.3
    assert s["pauses"] == 1
    assert abs(s["mean_pause_s"] - 0.6) < 0.02
    assert abs(s["pause_pct"] - 100 * 0.6 / 4.6) < 1
    assert abs(s["pauses_per_min"] - 60 * 1 / 4.6) < 0.1
    assert s["median_hz"] == 120
    assert abs(s["duration_s"] - 4.6) < 0.02


def test_clip_stats_cope_with_no_pauses_and_no_voicing():
    s = clip_stats(contour_from([("speech", 3.0)]))
    assert s["pauses"] == 0 and s["mean_pause_s"] is None and s["pause_pct"] == 0 and s["pauses_per_min"] == 0
    silent = clip_stats(contour_from([("silence", 2.0)]))
    assert silent["median_hz"] is None and silent["syllables_per_s"] is None


def test_calibration_is_a_modest_documented_correction():
    # Fitted against transcript syllable counts of the 20 clips (2026-10-22): the
    # detector undercounted by about 20%. Guard against it drifting to something wild.
    assert 1.0 <= SYLLABLE_CALIBRATION <= 1.5


def test_small_loudness_wobbles_are_not_syllables():
    # 4 Hz bumps of only 2 dB: under the prominence threshold, so not counted.
    c = contour_from([("speech", 2.0)], syllables_per_s=4.0)
    c["rms_db"] = -20 - 2 * (0.5 + 0.5 * np.cos(2 * np.pi * 4.0 * c["time"]))
    assert len(syllable_peaks(c)) == 0


def test_pause_rate_is_comparable_across_clip_lengths():
    # Same speaking style (one 0.4 s pause after every 2 s of speech), different clip lengths.
    short = clip_stats(contour_from([("speech", 2.0), ("silence", 0.4)] * 3 + [("speech", 2.0)]))
    long = clip_stats(contour_from([("speech", 2.0), ("silence", 0.4)] * 7 + [("speech", 2.0)]))
    # n pauses sit between n + 1 blocks of speech, so the true rates differ slightly:
    assert abs(short["pauses_per_min"] - 60 * 3 / 9.2) < 0.1
    assert abs(long["pauses_per_min"] - 60 * 7 / 18.8) < 0.1
    # ...but the rates stay within 15% of each other while the raw counts differ by over 2x.
    assert long["pauses"] / short["pauses"] > 2
    assert long["pauses_per_min"] / short["pauses_per_min"] < 1.15
