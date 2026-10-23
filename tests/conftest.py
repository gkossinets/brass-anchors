"""Shared test fixtures: synthetic voice-like signals with known pitch."""

import numpy as np
import pytest

SR = 22050


def harmonic_tone(f0: float, seconds: float, sr: int = SR, amp: float = 0.3) -> np.ndarray:
    """A buzzy vowel-like tone: 10 harmonics with 1/n amplitudes."""
    t = np.arange(int(seconds * sr)) / sr
    sig = sum(np.sin(2 * np.pi * f0 * n * t) / n for n in range(1, 11))
    return amp * sig / np.max(np.abs(sig))


@pytest.fixture
def voiced_gap_voiced() -> np.ndarray:
    """0.5 s at 150 Hz, 0.4 s silence, 0.5 s at 200 Hz."""
    return np.concatenate([
        harmonic_tone(150, 0.5),
        np.zeros(int(0.4 * SR)),
        harmonic_tone(200, 0.5),
    ])
