#!/usr/bin/env python3
"""Assemble the deployable site in dist/: the game plus only the media it plays.

web/audio links to processed/, which also holds contours, diagnostics, and
review context audio. The site gets real copies of just the files quiz.json
refers to, and leaves out the review tool and the tests.
"""

import argparse
import json
import shutil
import sys
from fnmatch import fnmatch
from pathlib import Path

from pipeline.config import ROOT, WEB_DIR

DIST_DIR = ROOT / "dist"
# Local-only things in web/: the clip review tool, unit tests, and the audio link (its files
# are copied one by one below). Other folders, such as fonts/, are copied whole.
EXCLUDE = ("review*", "*.test.js", "audio")


def referenced_files(manifest: dict) -> list[str]:
    """Every media path quiz.json points at: clip by clip, each clip's paths sorted.

    Args:
        manifest: The parsed quiz.json.

    Returns:
        Paths relative to web/, without duplicates.
    """
    paths: list[str] = []
    for clip in manifest["clips"]:
        own = list(clip["audio"].values()) + ([clip["thumbnail"]] if clip.get("thumbnail") else [])
        paths.extend(p for p in sorted(own) if p not in paths)
    return paths


def build_site(web_dir: Path, out_dir: Path) -> dict:
    """Replace out_dir with a fresh copy of the site.

    Args:
        web_dir: The game's web/ folder, with quiz.json built.
        out_dir: Where to write the site; deleted first.

    Returns:
        Counts: files, media_files, and bytes.

    Raises:
        FileNotFoundError: A file quiz.json refers to is missing.
        ValueError: out_dir is web_dir or inside it.
    """
    web_dir, out_dir = web_dir.resolve(), out_dir.resolve()
    if out_dir == web_dir or web_dir in out_dir.parents:
        raise ValueError(f"refusing to build into the source folder: {out_dir}")
    manifest = json.loads((web_dir / "quiz.json").read_text())
    media = referenced_files(manifest)
    # Check everything first, so a missing file doesn't leave a half-built site behind.
    missing = [p for p in media if not (web_dir / p).is_file()]
    if missing:
        raise FileNotFoundError(f"{len(missing)} file(s) in quiz.json are missing; run `make audio`: {', '.join(missing)}")

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    for src in sorted(web_dir.iterdir()):
        if any(fnmatch(src.name, pattern) for pattern in EXCLUDE):
            continue
        if src.is_dir():
            shutil.copytree(src, out_dir / src.name)  # asset folders, e.g. fonts/
        elif src.is_file():
            shutil.copy2(src, out_dir / src.name)
    for rel in media:
        dest = out_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(web_dir / rel, dest)  # follows the audio link: a real copy

    files = [p for p in out_dir.rglob("*") if p.is_file()]
    return {"files": len(files), "media_files": len(media), "bytes": sum(p.stat().st_size for p in files)}


def main() -> int:
    """Build dist/ from web/ and print what went in."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-o", "--out", type=Path, default=DIST_DIR, help="output folder (default: dist/)")
    args = parser.parse_args()
    try:
        summary = build_site(WEB_DIR, args.out)
    except (FileNotFoundError, ValueError) as err:
        print(f"build_site: {err}", file=sys.stderr)
        return 1
    print(f"{args.out}: {summary['files']} files ({summary['media_files']} media), "
          f"{summary['bytes'] / 1e6:.1f} MB", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
