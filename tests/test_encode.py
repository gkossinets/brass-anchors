import os
import subprocess

import numpy as np
import soundfile as sf

from pipeline.encode import BITRATE, encode_all, encode_mp3, needs_encoding

from conftest import SR, harmonic_tone


def duration(path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True)
    return float(out.stdout)


def write_wav(path, seconds: float = 2.0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, harmonic_tone(150, seconds), SR)


def test_mp3_is_much_smaller_and_keeps_the_length(tmp_path):
    src, dst = tmp_path / "a.wav", tmp_path / "a.mp3"
    write_wav(src, 5.0)
    encode_mp3(src, dst)
    assert dst.stat().st_size < src.stat().st_size / 5
    # Within ~2 MP3 frames: the game's progress bars and the spectrogram follow the clip's time.
    assert abs(duration(dst) - 5.0) < 0.06
    # Constant bitrate, so browsers seek precisely: the size follows from the length.
    kbps = int(BITRATE.rstrip("k"))
    assert abs(dst.stat().st_size - 5.0 * kbps * 1000 / 8) < 2000


def test_failed_encode_leaves_no_partial_file(tmp_path):
    src = tmp_path / "broken.wav"
    src.write_bytes(b"not audio")
    dst = tmp_path / "broken.mp3"
    try:
        encode_mp3(src, dst)
    except subprocess.CalledProcessError:
        pass
    else:
        raise AssertionError("expected ffmpeg to fail")
    assert not dst.exists() and not list(tmp_path.glob("*.tmp*"))


def test_needs_encoding_when_missing_or_older_than_the_wav(tmp_path):
    src, dst = tmp_path / "a.wav", tmp_path / "a.mp3"
    write_wav(src)
    assert needs_encoding(src, dst)
    encode_mp3(src, dst)
    assert not needs_encoding(src, dst)
    # A re-render (new contour, new timbre settings) rewrites the WAV: the MP3 is stale.
    later = dst.stat().st_mtime + 10
    os.utime(src, (later, later))
    assert needs_encoding(src, dst)


def test_encode_all_covers_every_kind_and_skips_up_to_date_files(tmp_path):
    for kind in ("original", "trombone"):
        for cid in ("x", "y"):
            write_wav(tmp_path / kind / f"{cid}.wav", 0.5)
    (tmp_path / "context").mkdir()
    sf.write(tmp_path / "context" / "x.wav", np.zeros(SR), SR)  # review-only audio: not for the site

    assert encode_all(tmp_path, ["original", "trombone"]) == 4
    assert sorted(p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*.mp3")) == [
        "original/x.mp3", "original/y.mp3", "trombone/x.mp3", "trombone/y.mp3"]
    assert encode_all(tmp_path, ["original", "trombone"]) == 0
    assert encode_all(tmp_path, ["original", "trombone"], force=True) == 4
