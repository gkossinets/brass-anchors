import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from pipeline.sources import (
    SourceUnavailable, covers, cut_from_source, ensure_source, load_meta, source_window,
)

SR = 16000
URL = "https://youtu.be/X"


def write_block(path: Path, seconds: float, tone_at: float | None = None) -> None:
    """Silence with an optional 1 s 440 Hz tone starting at tone_at."""
    y = np.zeros(int(seconds * SR))
    if tone_at is not None:
        i = int(tone_at * SR)
        y[i:i + SR] = 0.5 * np.sin(2 * np.pi * 440 * np.arange(SR) / SR)
    sf.write(path, y, SR)


def fake_download(seconds_written: float | None = None, fail: bool = False):
    """A stand-in for yt-dlp that records calls and writes a block of the window's length."""
    calls = []

    def download(url: str, window: tuple[float, float], out_stem: Path) -> Path:
        calls.append((url, window))
        if fail:
            raise SourceUnavailable("video unavailable")
        out = out_stem.with_suffix(".wav")
        write_block(out, seconds_written or (window[1] - window[0]))
        return out

    download.calls = calls
    return download


def test_source_window_pads_by_a_minute_and_clamps_at_zero():
    assert source_window(100.0, 115.0) == (40.0, 175.0)
    assert source_window(10.0, 25.0) == (0.0, 85.0)


def test_covers_requires_same_url_and_a_cut_inside_the_block():
    meta = {"url": URL, "window_start": 40.0, "duration": 135.0}
    assert covers(meta, URL, 41.0, 60.0)
    assert covers(meta, URL, 40.0, 175.0)
    assert not covers(meta, URL, 39.0, 60.0)
    assert not covers(meta, URL, 160.0, 176.0)
    assert not covers(meta, "https://youtu.be/OTHER", 41.0, 60.0)
    assert not covers(None, URL, 41.0, 60.0)


def test_ensure_downloads_once_then_reuses_the_cached_block(tmp_path):
    download = fake_download()
    path = ensure_source("c", URL, 100.0, 115.0, tmp_path, download)
    assert path.exists() and download.calls == [(URL, (40.0, 175.0))]
    meta = load_meta(tmp_path, "c")
    assert meta["window_start"] == 40.0 and abs(meta["duration"] - 135.0) < 0.01

    again = ensure_source("c", URL, 102.0, 130.0, tmp_path, download)
    assert again == path and len(download.calls) == 1


def test_ensure_refetches_when_the_cut_leaves_the_block(tmp_path):
    download = fake_download()
    ensure_source("c", URL, 100.0, 115.0, tmp_path, download)
    ensure_source("c", URL, 300.0, 315.0, tmp_path, download)
    assert download.calls[-1] == (URL, (240.0, 375.0))
    assert load_meta(tmp_path, "c")["window_start"] == 240.0


def test_failed_download_keeps_the_previous_block(tmp_path):
    ensure_source("c", URL, 100.0, 115.0, tmp_path, fake_download())
    before = sorted(p.name for p in tmp_path.iterdir())
    meta_before = load_meta(tmp_path, "c")
    with pytest.raises(SourceUnavailable):
        ensure_source("c", URL, 300.0, 315.0, tmp_path, fake_download(fail=True))
    assert sorted(p.name for p in tmp_path.iterdir()) == before
    assert load_meta(tmp_path, "c") == meta_before


def test_short_block_near_video_end_only_covers_what_exists(tmp_path):
    # Asking for 60 s past the end of a video yields a shorter file; trust the file.
    ensure_source("c", URL, 100.0, 115.0, tmp_path, fake_download(seconds_written=80.0))
    meta = load_meta(tmp_path, "c")
    assert not covers(meta, URL, 100.0, 125.0)  # block really ends at 40 + 80 = 120


def test_cut_lands_on_the_requested_source_times(tmp_path):
    block = tmp_path / "block.wav"
    write_block(block, 30.0, tone_at=12.0)  # block starts at source time 40, so tone at 52-53
    meta = {"url": URL, "window_start": 40.0, "duration": 30.0}
    out = tmp_path / "cut.wav"
    cut_from_source(meta, block, 51.0, 55.0, out)
    y, sr = sf.read(out)
    assert abs(len(y) / sr - 4.0) < 0.02
    loud = np.flatnonzero(np.abs(y) > 0.1) / sr
    assert abs(loud[0] - 1.0) < 0.02 and abs(loud[-1] - 2.0) < 0.02


def test_cut_outside_the_block_is_refused(tmp_path):
    block = tmp_path / "block.wav"
    write_block(block, 30.0)
    with pytest.raises(ValueError):
        cut_from_source({"url": URL, "window_start": 40.0, "duration": 30.0}, block, 65.0, 75.0, tmp_path / "x.wav")


def test_meta_is_plain_json_next_to_the_block(tmp_path):
    ensure_source("c", URL, 100.0, 115.0, tmp_path, fake_download())
    data = json.loads((tmp_path / "c.json").read_text())
    assert data["url"] == URL and data["file"].startswith("c.")
