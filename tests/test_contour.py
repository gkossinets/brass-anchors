import numpy as np

from conftest import SR
from pipeline.extract_contour import extract_contour, median_smooth_voiced


def test_f0_tracks_known_pitch_and_leaves_gap_unvoiced(voiced_gap_voiced):
    c = extract_contour(voiced_gap_voiced, SR, floor=60, ceiling=300)
    t, f0 = c["time"], c["f0"]

    first = f0[(t > 0.1) & (t < 0.4)]
    gap = f0[(t > 0.6) & (t < 0.8)]
    second = f0[(t > 1.0) & (t < 1.3)]

    assert np.nanmedian(first) == np.float64(np.nanmedian(first))  # not all NaN
    assert abs(np.nanmedian(first) - 150) < 3
    assert abs(np.nanmedian(second) - 200) < 3
    assert np.all(np.isnan(gap))


def test_contour_has_10ms_hop_and_aligned_arrays(voiced_gap_voiced):
    c = extract_contour(voiced_gap_voiced, SR, floor=60, ceiling=300)
    assert np.allclose(np.diff(c["time"]), 0.01, atol=1e-6)
    n = len(c["time"])
    assert len(c["f0"]) == len(c["voicing"]) == len(c["rms_db"]) == n


def test_rms_is_much_lower_in_silence(voiced_gap_voiced):
    c = extract_contour(voiced_gap_voiced, SR, floor=60, ceiling=300)
    t, rms = c["time"], c["rms_db"]
    assert np.median(rms[(t > 0.65) & (t < 0.75)]) < np.median(rms[(t > 0.1) & (t < 0.4)]) - 40


def test_median_smoothing_removes_spike_but_does_not_bridge_gaps():
    f0 = np.array([100, 100, 300, 100, 100, np.nan, np.nan, np.nan, 120, 120, 120])
    out = median_smooth_voiced(f0, width=3)
    assert out[2] == 100
    assert np.all(np.isnan(out[5:8]))
    assert np.allclose(out[8:], 120)


def test_flat_pitch_runs_flag_bleeps_and_tones_but_not_speech():
    from pipeline.extract_contour import flat_pitch_runs

    rng = np.random.default_rng(0)
    speech = 200 + np.cumsum(rng.normal(0, 3, 100))  # 1 s of wandering pitch
    bleep = np.full(40, 330.0)  # 0.4 s dead-flat tone
    f0 = np.concatenate([speech, [np.nan] * 5, bleep, [np.nan] * 5, speech])
    runs = flat_pitch_runs(f0, hop=0.01)
    assert runs == [(1.05, 1.45)]
    assert flat_pitch_runs(speech, hop=0.01) == []


def test_contour_is_stale_when_the_clip_pitch_range_changes(tmp_path, voiced_gap_voiced):
    from pipeline.extract_contour import contour_is_current, save_contour

    path = tmp_path / "c.npz"
    save_contour(path, extract_contour(voiced_gap_voiced, SR, floor=60, ceiling=300), (60.0, 300.0))
    assert contour_is_current(path, (60.0, 300.0))
    assert not contour_is_current(path, (100.0, 500.0))  # speaker re-identified as a woman
    assert not contour_is_current(tmp_path / "missing.npz", (60.0, 300.0))


def test_contour_saved_before_ranges_were_recorded_counts_as_stale(tmp_path, voiced_gap_voiced):
    from pipeline.extract_contour import contour_is_current

    path = tmp_path / "old.npz"
    np.savez(path, **extract_contour(voiced_gap_voiced, SR, floor=60, ceiling=300))
    assert not contour_is_current(path, (60.0, 300.0))
