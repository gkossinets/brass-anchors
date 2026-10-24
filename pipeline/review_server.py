#!/usr/bin/env python3
"""Local server for the clip review page: serves web/ and edits clips.csv.

Run with `make review`, then open http://localhost:8001/review.html.
Binds to 127.0.0.1 only: it writes files and runs the pipeline.
"""

import argparse
import json
import subprocess
import sys
import threading
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

import numpy as np

from pipeline.clips import load_clips, parse_timestamp
from pipeline.config import CLIPS_CSV, PROCESSED_DIR, RAW_DIR, ROOT, SOURCES_DIR, WEB_DIR
from pipeline.extract_contour import flat_pitch_runs
from pipeline.fetch import clear_outputs, fetch_clip
from pipeline.review import context_window, read_rows, update_clip, validate_changes
from pipeline.sources import SourceUnavailable, covers, cut_from_source, ensure_source, load_meta
from pipeline.static_server import RangeRequestHandler

MEDIA_KINDS = {"original": "wav", "trombone": "wav", "diagnostics": "png", "thumbnails": "jpg"}


@dataclass
class ReviewConfig:
    """Paths plus the slow operations, injectable so tests never call yt-dlp."""

    csv_path: Path
    web_dir: Path
    processed_dir: Path
    rebuild: Callable[[str], str]
    fetch_context: Callable[[str, str, tuple[float, float]], tuple[float, float]]
    build_manifest: Callable[[], str]
    prepare: Callable[[str, str, float, float], None]


def _run(*module_args: str) -> str:
    result = subprocess.run([sys.executable, "-m", *module_args], cwd=ROOT, capture_output=True, text=True)
    return result.stderr + result.stdout


def default_prepare(clip_id: str, url: str, start: float, end: float) -> None:
    """Make sure the cached source block covers new times, before anything is saved.

    Raises:
        SourceUnavailable: The block isn't cached and can't be downloaded.
    """
    ensure_source(clip_id, url, start, end, SOURCES_DIR)


def default_rebuild(clip_id: str) -> str:
    """Re-cut one clip from its cached block, then redo its later stages.

    The raw cut replaces the old one atomically. Derived files are deleted only
    after that, and every stage skips outputs that exist, so only this clip is redone.
    """
    clip = next(c for c in load_clips(CLIPS_CSV) if c.id == clip_id)
    fetch_clip(clip, RAW_DIR, SOURCES_DIR)
    clear_outputs(clip_id, PROCESSED_DIR)
    return "".join(_run(*args) for args in (
        ("pipeline.trim_normalize",), ("pipeline.extract_contour",), ("pipeline.synth",), ("pipeline.encode",),
    ))


def default_fetch_context(clip_id: str, url: str, window: tuple[float, float]) -> tuple[float, float]:
    """Cut the stretch around a clip from its cached block into processed/context/.

    Near the end of a video the block may stop short of the full window, so the
    window is clipped to what the block holds.

    Returns:
        The (start, end) source times actually written.
    """
    meta = load_meta(SOURCES_DIR, clip_id)
    if not covers(meta, url, *window):
        clip = next(c for c in load_clips(CLIPS_CSV) if c.id == clip_id)
        ensure_source(clip_id, url, parse_timestamp(clip.start), parse_timestamp(clip.end), SOURCES_DIR)
        meta = load_meta(SOURCES_DIR, clip_id)
    window = (max(window[0], meta["window_start"]), min(window[1], meta["window_start"] + meta["duration"]))
    out_dir = PROCESSED_DIR / "context"
    out_dir.mkdir(parents=True, exist_ok=True)
    cut_from_source(meta, SOURCES_DIR / meta["file"], *window, out_dir / f"{clip_id}.wav")
    return window


def default_build_manifest() -> str:
    """Refresh thumbnails and web/quiz.json so edits (speaker, genre, rejections) reach the game."""
    return _run("pipeline.thumbnails") + _run("pipeline.build_manifest")


def _media(processed_dir: Path, clip_id: str) -> dict[str, str]:
    """URLs for this clip's files, versioned by mtime so re-renders bypass the cache."""
    media = {}
    for kind, ext in MEDIA_KINDS.items():
        path = processed_dir / kind / f"{clip_id}.{ext}"
        if path.exists():
            media[kind] = f"audio/{kind}/{clip_id}.{ext}?v={int(path.stat().st_mtime)}"
    return media


def _stats(processed_dir: Path, clip_id: str) -> dict | None:
    path = processed_dir / "contours" / f"{clip_id}.npz"
    if not path.exists():
        return None
    c = np.load(path)
    f0 = c["f0"]
    voiced = f0[~np.isnan(f0)]
    return {
        "voiced_pct": round(100 * len(voiced) / len(f0)),
        "median_f0": round(float(np.median(voiced))) if len(voiced) else None,
        "steady_tones": flat_pitch_runs(f0),
    }


class ReviewHandler(RangeRequestHandler):
    """Static files from web/ plus a small JSON API under /api/."""

    config: ReviewConfig
    lock = threading.Lock()  # one write or rebuild at a time

    def log_message(self, format: str, *args) -> None:  # quieter than the default
        if not self.path.startswith(("/audio/", "/api/clips ")):
            sys.stderr.write(f"{self.address_string()} {format % args}\n")

    def _json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _clip(self, row: dict[str, str]) -> dict:
        return {**row, "media": _media(self.config.processed_dir, row["id"]),
                "stats": _stats(self.config.processed_dir, row["id"])}

    def do_GET(self) -> None:
        if self.path.split("?")[0] == "/api/clips":
            _, rows = read_rows(self.config.csv_path)
            for row in rows:
                row.setdefault("review_status", "")
                row.setdefault("review_notes", "")
            self._json(200, {"clips": [self._clip(r) for r in rows]})
        else:
            super().do_GET()

    def do_POST(self) -> None:
        parts = self.path.split("?")[0].strip("/").split("/")
        if len(parts) < 3 or parts[:2] != ["api", "clips"]:
            self._json(404, {"error": "not found"})
            return
        clip_id = parts[2]
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "body must be JSON"})
            return
        with self.lock:
            if parts[3:] == ["context"]:
                self._context(clip_id)
            elif len(parts) == 3:
                self._save(clip_id, body)
            else:
                self._json(404, {"error": "not found"})

    def _row(self, clip_id: str) -> dict[str, str] | None:
        return next((r for r in read_rows(self.config.csv_path)[1] if r["id"] == clip_id), None)

    def _save(self, clip_id: str, changes: dict) -> None:
        changes = {k: str(v).strip() for k, v in changes.items()}
        row = self._row(clip_id)
        if row is None:
            self._json(404, {"error": f"no clip {clip_id}"})
            return
        try:
            validate_changes(row, changes)
        except ValueError as err:
            self._json(400, {"error": str(err)})
            return
        start = parse_timestamp(changes.get("start", row["start"]))
        end = parse_timestamp(changes.get("end", row["end"]))
        if (start, end) != (parse_timestamp(row["start"]), parse_timestamp(row["end"])):
            # Secure the audio before touching clips.csv: if the video has gone,
            # the clip keeps its old times and its old audio.
            try:
                self.config.prepare(clip_id, row["url"], start, end)
            except SourceUnavailable as err:
                self._json(502, {"error": f"nothing changed; couldn't get audio for the new times: {err}"})
                return
        moved = update_clip(self.config.csv_path, clip_id, changes)
        log = self.config.rebuild(clip_id) if moved else ""
        log += self.config.build_manifest()
        self._json(200, {"clip": self._clip(self._row(clip_id)), "rebuilt": moved, "log": log})

    def _context(self, clip_id: str) -> None:
        row = self._row(clip_id)
        if row is None:
            self._json(404, {"error": f"no clip {clip_id}"})
            return
        start, end = parse_timestamp(row["start"]), parse_timestamp(row["end"])
        try:
            window = self.config.fetch_context(clip_id, row["url"], context_window(start, end))
        except (SourceUnavailable, subprocess.CalledProcessError) as err:
            self._json(502, {"error": f"context unavailable: {err}"})
            return
        path = self.config.processed_dir / "context" / f"{clip_id}.wav"
        version = int(path.stat().st_mtime) if path.exists() else 0
        self._json(200, {"audio": f"audio/context/{clip_id}.wav?v={version}",
                         "window_start": window[0], "clip_start": start, "clip_end": end})


def make_server(config: ReviewConfig, port: int) -> ThreadingHTTPServer:
    """An HTTP server bound to localhost for the given config."""
    handler = type("BoundReviewHandler", (ReviewHandler,), {"config": config})
    return ThreadingHTTPServer(("127.0.0.1", port), partial(handler, directory=str(config.web_dir)))


def main() -> int:
    """Serve the review page until interrupted."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-p", "--port", type=int, default=8001)
    args = parser.parse_args()
    config = ReviewConfig(CLIPS_CSV, WEB_DIR, PROCESSED_DIR, default_rebuild, default_fetch_context,
                          default_build_manifest, default_prepare)
    httpd = make_server(config, args.port)
    print(f"Review page: http://localhost:{args.port}/review.html  (Ctrl-C to stop)", file=sys.stderr)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
