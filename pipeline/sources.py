"""Local cache of padded source audio, so clips can be re-cut without YouTube.

Each clip keeps a block of the source video's audio (its section plus a minute
either side) in sources/, as the original compressed stream, with a JSON note
of where the block sits in the video. Cuts are made locally with ffmpeg; the
network is used only when a cut falls outside the block. A new block replaces
the old one only after it downloads successfully, because many sources are
re-uploads that can vanish at any time.
"""

import json
import os
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

SOURCE_PAD_SECONDS = 60.0
# Cut points within this of the block's edges still count as covered (container rounding).
EDGE_TOLERANCE = 0.05


class SourceUnavailable(RuntimeError):
    """The source block couldn't be downloaded (video removed, network down, ...)."""


def source_window(start: float, end: float, pad: float = SOURCE_PAD_SECONDS) -> tuple[float, float]:
    """The stretch of video to cache for a clip: its section plus `pad` either side."""
    return max(0.0, start - pad), end + pad


def load_meta(sources_dir: Path, clip_id: str) -> dict | None:
    """The cached block's note, or None if there's no block yet."""
    path = sources_dir / f"{clip_id}.json"
    return json.loads(path.read_text()) if path.exists() else None


def covers(meta: dict | None, url: str, start: float, end: float) -> bool:
    """Whether the cached block contains the whole cut [start, end] of this video."""
    if meta is None or meta["url"] != url:
        return False
    block_start, block_end = meta["window_start"], meta["window_start"] + meta["duration"]
    return start >= block_start - EDGE_TOLERANCE and end <= block_end + EDGE_TOLERANCE


def probe_duration(path: Path) -> float:
    """Length of an audio file in seconds, via ffprobe."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def source_command(url: str, window: tuple[float, float], out_stem: Path) -> list[str]:
    """yt-dlp argv for one section of a video's best audio stream (not re-encoded).

    --force-keyframes-at-cuts makes the section start exactly at window[0];
    without it the block starts at an earlier keyframe and every cut is offset.
    """
    return [
        "yt-dlp", "-q", "--no-warnings", "-f", "bestaudio",
        "--download-sections", f"*{window[0]:.2f}-{window[1]:.2f}", "--force-keyframes-at-cuts",
        "-o", f"{out_stem}.%(ext)s", url,
    ]


def yt_dlp_download(url: str, window: tuple[float, float], out_stem: Path) -> Path:
    """Download one section of a video's best audio stream.

    Raises:
        SourceUnavailable: yt-dlp failed (the message carries its last words).
    """
    result = subprocess.run(source_command(url, window, out_stem), capture_output=True, text=True)
    produced = [p for p in out_stem.parent.glob(f"{out_stem.name}.*") if not p.name.endswith(".part")]
    if result.returncode != 0 or not produced:
        raise SourceUnavailable(f"yt-dlp failed for {url}: {(result.stderr or result.stdout).strip()[-300:]}")
    return produced[0]


def ensure_source(
    clip_id: str,
    url: str,
    start: float,
    end: float,
    sources_dir: Path,
    download: Callable[[str, tuple[float, float], Path], Path] = yt_dlp_download,
) -> Path:
    """Return a cached block covering [start, end], downloading one only if needed.

    The download goes to a temporary folder and replaces the cached block only
    once it has succeeded and really covers the cut.

    Raises:
        SourceUnavailable: The block couldn't be fetched; the previous block is untouched.
    """
    sources_dir.mkdir(parents=True, exist_ok=True)
    meta = load_meta(sources_dir, clip_id)
    if covers(meta, url, start, end):
        return sources_dir / meta["file"]

    window = source_window(start, end)
    tmp = Path(tempfile.mkdtemp(dir=sources_dir, prefix=f".tmp-{clip_id}-"))
    try:
        fetched = download(url, window, tmp / clip_id)
        new_meta = {"url": url, "window_start": window[0], "duration": round(probe_duration(fetched), 3),
                    "file": f"{clip_id}{fetched.suffix}"}
        if not covers(new_meta, url, start, end):
            raise SourceUnavailable(
                f"{clip_id}: the video ends at about {window[0] + new_meta['duration']:.1f} s, before the cut's end ({end:.1f} s)")
        if meta and meta["file"] != new_meta["file"]:
            (sources_dir / meta["file"]).unlink(missing_ok=True)
        os.replace(fetched, sources_dir / new_meta["file"])
        meta_tmp = tmp / "meta.json"
        meta_tmp.write_text(json.dumps(new_meta, indent=1))
        os.replace(meta_tmp, sources_dir / f"{clip_id}.json")
        return sources_dir / new_meta["file"]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def cut_from_source(meta: dict, block: Path, start: float, end: float, out: Path) -> None:
    """Cut source time [start, end] out of a cached block into a WAV, atomically.

    Raises:
        ValueError: The cut isn't inside the block.
    """
    if not covers(meta, meta["url"], start, end):
        raise ValueError(f"cut {start:.2f}-{end:.2f} s is outside the cached block")
    offset = max(0.0, start - meta["window_start"])
    tmp = out.with_name(f".{out.stem}.tmp.wav")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", f"{offset:.3f}", "-i", str(block),
         "-t", f"{end - start:.3f}", "-vn", str(tmp)],
        check=True, capture_output=True,
    )
    os.replace(tmp, out)
