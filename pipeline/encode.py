#!/usr/bin/env python3
"""Encode the game's WAVs (original and every timbre) to MP3 for the browser.

The WAVs stay the pipeline's working files: synthesis, stats, and the review
page read them. The game plays the MP3s, about a sixth of the size.
"""

import argparse
import subprocess
import sys
from pathlib import Path

from pipeline.config import PROCESSED_DIR
from pipeline.synth import TIMBRES

# Constant bitrate, so browsers can seek precisely (VBR seeking can drift).
# 48 kbit/s mono at 22.05 kHz keeps speech and the synthesized harmonics clean.
BITRATE = "48k"
KINDS = ["original", *TIMBRES]


def encode_mp3(src: Path, dst: Path) -> None:
    """Encode one WAV to MP3, replacing dst only when ffmpeg succeeds.

    Raises:
        subprocess.CalledProcessError: ffmpeg failed; dst is left as it was.
    """
    tmp = dst.with_name(f".{dst.stem}.tmp.mp3")
    try:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-codec:a", "libmp3lame", "-b:a", BITRATE, str(tmp)],
            check=True, capture_output=True,
        )
        tmp.replace(dst)
    finally:
        tmp.unlink(missing_ok=True)


def needs_encoding(src: Path, dst: Path) -> bool:
    """True when the MP3 is missing or older than its WAV (the WAV was re-rendered)."""
    return not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime


def encode_all(processed_dir: Path, kinds: list[str], force: bool = False) -> int:
    """Encode every WAV under processed_dir/<kind>/ that needs it.

    Returns:
        How many files were encoded.
    """
    done = 0
    for kind in kinds:
        for src in sorted((processed_dir / kind).glob("*.wav")):
            dst = src.with_suffix(".mp3")
            if force or needs_encoding(src, dst):
                encode_mp3(src, dst)
                done += 1
    return done


def main() -> int:
    """Encode what's new or changed and report the count."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-f", "--force", action="store_true", help="re-encode everything")
    args = parser.parse_args()
    try:
        done = encode_all(PROCESSED_DIR, KINDS, args.force)
    except subprocess.CalledProcessError as err:
        print(f"encode: ffmpeg failed: {err.stderr.decode(errors='replace').strip()}", file=sys.stderr)
        return 1
    print(f"encoded {done} file(s) to MP3 at {BITRATE}bit/s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
