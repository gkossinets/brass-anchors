import numpy as np
import pyloudnorm as pyln

from conftest import harmonic_tone
from pipeline.trim_normalize import prepare_audio


def test_output_is_mono_resampled_faded_and_loudness_normalized():
    sr_in = 44100
    mono = harmonic_tone(180, 2.0, sr=sr_in, amp=0.05)
    stereo = np.stack([mono, mono], axis=1)

    out, sr = prepare_audio(stereo, sr_in, target_sr=22050, target_lufs=-23.0, fade_ms=50)

    assert sr == 22050
    assert out.ndim == 1
    assert abs(len(out) - 2.0 * 22050) < 5
    assert abs(pyln.Meter(sr).integrated_loudness(out) - (-23.0)) < 0.5
    assert abs(out[0]) < 1e-3 and abs(out[-1]) < 1e-3
    assert np.max(np.abs(out)) <= 1.0


def test_duration_check_flags_clips_that_do_not_match_csv_section():
    from pipeline.trim_normalize import duration_problem

    assert duration_problem(actual=15.02, expected=15.0) is None
    assert "23.0" in duration_problem(actual=23.0, expected=15.0)
