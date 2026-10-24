#!/usr/bin/env python3
"""Make small web thumbnails from the speaker screenshots in thumbnails/.

Screenshots are named after the speaker ("Walter Cronkite.png") and matched
to clips by the speaker column in clips.csv, ignoring case and accents. Each clip
gets processed/thumbnails/<id>.jpg, shown next to the speaker's name when
the answer is revealed.
"""

import argparse
import sys
import unicodedata
from pathlib import Path

from PIL import Image

from pipeline.clips import load_clips
from pipeline.config import CLIPS_CSV, PROCESSED_DIR, THUMBNAIL_SRC_DIR

THUMBNAIL_DIR = PROCESSED_DIR / "thumbnails"
# Twice the on-screen width, for sharp display on high-density screens.
THUMB_WIDTH = 240
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def name_key(name: str) -> str:
    """A speaker name reduced for matching file names: no case, no accents ("Léon" == "leon")."""
    decomposed = unicodedata.normalize("NFKD", name)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).casefold()


def match_thumbnails(speakers: dict[str, str], folder: Path) -> tuple[dict[str, Path], list[str], list[str]]:
    """Pair clips with screenshots by speaker name.

    Args:
        speakers: clip id -> speaker name.
        folder: Directory of screenshots named after speakers.

    Returns:
        (clip id -> screenshot, clip ids with no screenshot, screenshot names matching no clip)
    """
    by_name = {name_key(p.stem): p for p in sorted(folder.iterdir()) if p.suffix.lower() in IMAGE_SUFFIXES}
    matches = {cid: by_name[name_key(name)] for cid, name in speakers.items() if name_key(name) in by_name}
    missing = [cid for cid in speakers if cid not in matches]
    used = {p.name for p in matches.values()}
    unused = [p.name for p in by_name.values() if p.name not in used]
    return matches, missing, unused


def make_thumbnail(src: Path, dst: Path, width: int = THUMB_WIDTH) -> None:
    """Write a JPEG at most `width` pixels wide, keeping the aspect ratio."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im = im.convert("RGB")
        if im.width > width:
            im = im.resize((width, round(width * im.height / im.width)), Image.LANCZOS)
        im.save(dst, "JPEG", quality=82, optimize=True)


def main() -> int:
    """Regenerate every clip's thumbnail (it's cheap) and report mismatches."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.parse_args()
    if not THUMBNAIL_SRC_DIR.is_dir():
        print(f"no {THUMBNAIL_SRC_DIR.name}/ folder; skipping thumbnails", file=sys.stderr)
        return 0
    clips = load_clips(CLIPS_CSV)
    matches, missing, unused = match_thumbnails({c.id: c.speaker for c in clips}, THUMBNAIL_SRC_DIR)
    for cid, src in matches.items():
        make_thumbnail(src, THUMBNAIL_DIR / f"{cid}.jpg")
    for cid in missing:  # e.g. a speaker was renamed: drop the old picture rather than show the wrong face
        (THUMBNAIL_DIR / f"{cid}.jpg").unlink(missing_ok=True)
    print(f"thumbnails: {len(matches)} made", file=sys.stderr)
    for cid in missing:
        print(f"  warning: no screenshot for {cid}", file=sys.stderr)
    for name in unused:
        print(f"  warning: {THUMBNAIL_SRC_DIR.name}/{name} matches no speaker in clips.csv", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
