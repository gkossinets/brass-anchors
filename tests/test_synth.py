import numpy as np
import pytest

from conftest import SR
from pipeline.extract_contour import extract_contour
from pipeline.synth import TIMBRES, peak_gain, resonance_gain, synthesize

ALL = sorted(TIMBRES)


def contour(f0_value: float, rms_db: float, seconds: float = 1.0) -> dict:
    t = np.arange(0, seconds, 0.01)
    return {
        "time": t,
        "f0": np.full_like(t, f0_value),
        "rms_db": np.full_like(t, rms_db),
    }


def tracked_pitch(y: np.ndarray) -> float:
    c = extract_contour(y, SR, floor=60, ceiling=600)
    return float(np.nanmedian(c["f0"][20:80]))


def harmonic_amplitude(y: np.ndarray, freq: float) -> float:
    seg = y[int(0.2 * SR):int(0.8 * SR)]
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    freqs = np.fft.rfftfreq(len(seg), 1 / SR)
    return float(spec[np.argmin(np.abs(freqs - freq))])


def test_timbre_set_with_trombone_first_as_the_game_default():
    # The game starts on the manifest's first timbre.
    assert list(TIMBRES) == ["trombone", "brass", "hum"]


def test_voice_like_timbres_are_not_transposed_and_brass_is():
    assert TIMBRES["brass"].transpose_semitones == 12
    for name in ("hum", "trombone"):
        assert TIMBRES[name].transpose_semitones == 0


@pytest.mark.parametrize("name", ALL)
def test_output_pitch_follows_contour_with_timbre_transposition(name):
    timbre = TIMBRES[name]
    y = synthesize(contour(150, -20), SR, timbre)
    expected = 150 * 2 ** (timbre.transpose_semitones / 12)
    assert abs(1200 * np.log2(tracked_pitch(y) / expected)) < 30  # cents


@pytest.mark.parametrize("name", ALL)
def test_unvoiced_frames_are_silent(name):
    c = contour(150, -20, seconds=1.0)
    c["f0"][40:70] = np.nan
    y = synthesize(c, SR, TIMBRES[name])
    silent = y[int(0.5 * SR):int(0.65 * SR)]
    assert np.max(np.abs(silent)) < 1e-6


@pytest.mark.parametrize("name", ALL)
def test_quiet_frames_below_gate_are_silent(name):
    y = synthesize(contour(150, -70), SR, TIMBRES[name], gate_db=-50)
    assert np.max(np.abs(y)) < 1e-6


@pytest.mark.parametrize("name", ALL)
def test_onsets_ramp_instead_of_clicking(name):
    c = contour(150, -20, seconds=1.0)
    c["f0"][:50] = np.nan
    y = synthesize(c, SR, TIMBRES[name])
    onset = int(0.5 * SR)
    assert np.max(np.abs(y[onset:onset + int(0.002 * SR)])) < 0.5 * np.max(np.abs(y))


@pytest.mark.parametrize("name", ALL)
def test_louder_frames_are_brighter(name):
    def brightness(rms_db: float) -> float:
        y = synthesize(contour(150, rms_db), SR, TIMBRES[name])
        seg = y[int(0.2 * SR):int(0.8 * SR)]
        spec = np.abs(np.fft.rfft(seg))
        freqs = np.fft.rfftfreq(len(seg), 1 / SR)
        return np.sum(spec[freqs > 1500]) / np.sum(spec)

    assert brightness(-10) > brightness(-35)


@pytest.mark.parametrize("name", ALL)
def test_louder_frames_have_larger_amplitude(name):
    loud = synthesize(contour(150, -10), SR, TIMBRES[name])
    soft = synthesize(contour(150, -30), SR, TIMBRES[name])
    assert np.std(loud) > 2 * np.std(soft)


def test_resonance_gain_is_unity_at_dc_and_peaks_at_its_frequency():
    f = np.array([0.0, 250.0, 500.0, 1000.0])
    g = resonance_gain(f, [(500.0, 80.0)])
    assert abs(g[0] - 1.0) < 1e-9
    assert g[2] > g[1] and g[2] > g[3]
    assert g[2] > 5


def test_hum_vowel_resonance_stays_fixed_as_pitch_changes():
    # A voice keeps its vowel when the pitch moves: the strongest region of the
    # spectrum should sit near F1 for both a low and a higher speaking pitch.
    f1 = TIMBRES["hum"].formants[0][0]
    for f0 in (100.0, 125.0):
        y = synthesize(contour(f0, -20), SR, TIMBRES["hum"])
        amps = {n: harmonic_amplitude(y, n * f0) for n in range(1, 12)}
        loudest_above_fundamental = max((n for n in amps if n > 1), key=amps.get)
        assert abs(loudest_above_fundamental * f0 - f1) <= f0


def test_peak_gain_boosts_near_peaks_and_is_flat_far_away():
    # Instrument bodies boost some bands but don't roll the spectrum off the
    # way a stack of vocal-tract resonators does.
    f = np.array([50.0, 500.0, 5000.0])
    g = peak_gain(f, [(500.0, 100.0, 3.0)])
    assert abs(g[1] - 3.0) < 1e-9
    assert abs(g[0] - 1.0) < 0.05 and abs(g[2] - 1.0) < 0.01


def test_trombone_keeps_energy_in_the_upper_harmonics():
    # Regression: with cascaded formants, instrument harmonics above ~1.5 kHz
    # were 60 dB down and sounded muffled.
    y = synthesize(contour(130, -15), SR, TIMBRES["trombone"])
    low = harmonic_amplitude(y, 260)
    high = harmonic_amplitude(y, 130 * 16)  # ~2 kHz
    assert 20 * np.log10(high / low) > -35
