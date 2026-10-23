#!/usr/bin/env python3
"""Cut each clip in clips.csv into raw/, from a cached source block in sources/.

Blocks (each clip's section plus a minute either side) are downloaded only
when missing or when a clip's times move outside its block; see sources.py.
Each cut records the times it was made from (raw/<id>.json), so a clip whose
times change in clips.csv, by hand or on the review page, is re-cut and its
stale processed files are cleared for the later stages to rebuild.
"""

import argparse
import json
import os
import sys
from collections.abc import Callable
from pathlib import Path

from pipeline.clips import Clip, load_clips, parse_timestamp
from pipeline.config import CLIPS_CSV, PROCESSED_DIR, RAW_DIR, SOURCES_DIR
from pipeline.sources import SourceUnavailable, cut_from_source, ensure_source, load_meta, yt_dlp_download


def _record(clip: Clip) -> dict:
    return {"url": clip.url, "start": parse_timestamp(clip.start), "end": parse_timestamp(clip.end)}


def is_current(clip: Clip, raw_dir: Path) -> bool:
    """Whether raw/<id>.wav was cut from this clip's current URL and times."""
    wav, record = raw_dir / f"{clip.id}.wav", raw_dir / f"{clip.id}.json"
    return wav.exists() and record.exists() and json.loads(record.read_text()) == _record(clip)


def clear_outputs(clip_id: str, processed_dir: Path) -> None:
    """Delete a clip's derived files so the later stages rebuild them.

    processed/context/ (fetched on demand by the review page) and
    processed/thumbnails/ (made from screenshots, not audio) are left alone.
    """
    for path in processed_dir.glob(f"*/{clip_id}.*"):
        if path.parent.name not in ("context", "thumbnails"):
            path.unlink(missing_ok=True)


def fetch_clip(
    clip: Clip,
    raw_dir: Path,
    sources_dir: Path,
    download: Callable[[str, tuple[float, float], Path], Path] = yt_dlp_download,
) -> None:
    """Write raw/<id>.wav for a clip's current times, downloading only if the cache can't serve them.

    Raises:
        SourceUnavailable: A needed download failed; any existing raw/<id>.wav is untouched.
    """
    start, end = parse_timestamp(clip.start), parse_timestamp(clip.end)
    block = ensure_source(clip.id, clip.url, start, end, sources_dir, download)
    raw_dir.mkdir(parents=True, exist_ok=True)
    cut_from_source(load_meta(sources_dir, clip.id), block, start, end, raw_dir / f"{clip.id}.wav")
    tmp = raw_dir / f".{clip.id}.json.tmp"
    tmp.write_text(json.dumps(_record(clip)))
    os.replace(tmp, raw_dir / f"{clip.id}.json")


def refresh(
    clips: list[Clip],
    raw_dir: Path,
    processed_dir: Path,
    sources_dir: Path,
    download: Callable[[str, tuple[float, float], Path], Path] = yt_dlp_download,
    failures: list[str] | None = None,
) -> list[str]:
    """Re-cut every clip whose raw file is missing or was cut from other times.

    A clip that can't be re-cut (its block can't be downloaded) keeps its old
    files and is added to `failures`.

    Returns:
        Ids of the clips that were (re)cut.
    """
    recut = []
    for clip in clips:
        if is_current(clip, raw_dir):
            continue
        try:
            fetch_clip(clip, raw_dir, sources_dir, download)
        except SourceUnavailable as err:
            print(f"FAILED {clip.id}: {err}", file=sys.stderr)
            if failures is not None:
                failures.append(clip.id)
            continue
        clear_outputs(clip.id, processed_dir)
        print(f"cut {clip.id}", file=sys.stderr)
        recut.append(clip.id)
    return recut


def main() -> int:
    """Cut every clip that is new or whose times changed (or only cache sources, with --sources-only)."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--csv", type=Path, default=CLIPS_CSV)
    parser.add_argument("--only", nargs="*", help="clip ids to fetch")
    parser.add_argument("--sources-only", action="store_true",
                        help="make sure every clip has a cached source block; don't cut")
    args = parser.parse_args()

    clips = [c for c in load_clips(args.csv) if not args.only or c.id in args.only]
    failures: list[str] = []
    if args.sources_only:
        for clip in clips:
            try:
                ensure_source(clip.id, clip.url, parse_timestamp(clip.start), parse_timestamp(clip.end), SOURCES_DIR)
            except SourceUnavailable as err:
                print(f"FAILED {clip.id}: {err}", file=sys.stderr)
                failures.append(clip.id)
    else:
        refresh(clips, RAW_DIR, PROCESSED_DIR, SOURCES_DIR, failures=failures)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
