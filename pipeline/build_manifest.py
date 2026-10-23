#!/usr/bin/env python3
"""Write web/quiz.json from clips.csv, listing audio paths and answers per clip."""

import argparse
import json
import sys
from collections.abc import Callable
from pathlib import Path

import numpy as np

from pipeline.clips import Clip, load_clips, parse_timestamp
from pipeline.config import CLIPS_CSV, CONTOUR_DIR, PROCESSED_DIR, WEB_DIR
from pipeline.encode import KINDS, needs_encoding
from pipeline.stats import clip_stats
from pipeline.synth import TIMBRES


def youtube_link(url: str, start_seconds: float) -> str:
    """Append a start-time parameter so the reveal link opens at the clip."""
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}t={int(start_seconds)}s"


# Decimal places shown for each speech stat (0 = whole number).
STAT_DECIMALS = {"median_hz": 0, "range_st": 1, "sd_st": 1, "syllables_per_s": 1,
                 "pauses": 0, "pauses_per_min": 0, "mean_pause_s": 2, "pause_pct": 0, "duration_s": 1}


def rounded_stats(stats: dict | None) -> dict | None:
    """Round speech stats for display; None values stay None."""
    if stats is None:
        return None
    out = {}
    for key, places in STAT_DECIMALS.items():
        value = stats.get(key)
        out[key] = None if value is None else (int(round(value)) if places == 0 else round(float(value), places))
    return out


def clip_entry(clip: Clip, thumbnail: bool = False, stats: dict | None = None) -> dict:
    """The quiz.json record for one clip."""
    return {
        "id": clip.id,
        "audio": {kind: f"audio/{kind}/{clip.id}.mp3" for kind in KINDS},
        "answer": {
            "decade": clip.decade,
            "country": clip.country,
            "genre": clip.genre,
            "station": clip.station,
        },
        "speaker": clip.speaker,
        "program": clip.program,
        "year": clip.year,
        "recognizable": clip.recognizable,
        "date_confidence": clip.date_confidence,
        "link": youtube_link(clip.url, parse_timestamp(clip.start)),
        "thumbnail": f"audio/thumbnails/{clip.id}.jpg" if thumbnail else None,
        "stats": rounded_stats(stats),
    }


def build_manifest(
    clips: list[Clip],
    has_audio: Callable[[str], bool],
    exclude_low_confidence: bool = False,
    has_thumbnail: Callable[[str], bool] = lambda cid: False,
    stats_for: Callable[[str], dict | None] = lambda cid: None,
) -> dict:
    """Assemble the manifest, dropping clips whose audio isn't rendered yet.

    Args:
        clips: Parsed clips.csv rows.
        has_audio: Predicate: is every rendering (original and all timbres) encoded and current for this id?
        has_thumbnail: Predicate: is there a speaker thumbnail for this id?
        stats_for: Speech stats for this id (see pipeline.stats), or None.
        exclude_low_confidence: Drop clips with date_confidence == 'low'.
            Clips marked rejected in review are always dropped.

    Returns:
        {'clips': [...], 'skipped': [ids without audio]}
    """
    entries, skipped = [], []
    for clip in clips:
        if exclude_low_confidence and clip.date_confidence == "low":
            continue
        if clip.review_status == "rejected":
            continue
        if not has_audio(clip.id):
            skipped.append(clip.id)
            continue
        entries.append(clip_entry(clip, has_thumbnail(clip.id), stats_for(clip.id)))
    return {"clips": entries, "skipped": skipped}


def main() -> int:
    """Build web/quiz.json and report any clips left out for missing audio."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=CLIPS_CSV)
    parser.add_argument("--exclude-low-confidence", action="store_true")
    parser.add_argument("-o", "--output", type=Path, default=WEB_DIR / "quiz.json")
    args = parser.parse_args()

    def has_audio(cid: str) -> bool:
        wavs = [PROCESSED_DIR / kind / f"{cid}.wav" for kind in KINDS]
        # A missing or stale MP3 would play old audio, so the clip waits for `make encode`.
        return all(w.exists() and not needs_encoding(w, w.with_suffix(".mp3")) for w in wavs)

    def has_thumbnail(cid: str) -> bool:
        return (PROCESSED_DIR / "thumbnails" / f"{cid}.jpg").exists()

    def stats_for(cid: str) -> dict | None:
        path = CONTOUR_DIR / f"{cid}.npz"
        return clip_stats(dict(np.load(path))) if path.exists() else None

    manifest = build_manifest(load_clips(args.csv), has_audio, args.exclude_low_confidence, has_thumbnail, stats_for)
    timbres = [{"id": t.name, "label": t.label} for t in TIMBRES.values()]
    args.output.write_text(json.dumps({"timbres": timbres, "clips": manifest["clips"]}, ensure_ascii=False, indent=2))
    print(f"wrote {len(manifest['clips'])} clips to {args.output}", file=sys.stderr)
    for cid in manifest["skipped"]:
        print(f"  skipped {cid}: audio not rendered or not encoded (make audio)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
