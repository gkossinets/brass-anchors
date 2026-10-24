#!/usr/bin/env python3
"""Pick a speaker picture from the clip's own video for speakers without a screenshot.

For each speaker in clips.csv with no picture in thumbnails/, downloads the
clip's stretch of video (with some time either side) at low resolution, takes
frames across it, finds the face that keeps coming back to the same spot, and
saves a square head-and-shoulders crop as thumbnails/<speaker>.png. Anchors
return to their spot shot after shot, while the people in a report come and go. A screenshot you put there yourself always wins:
this only fills gaps, and a picked picture can be replaced by hand.
"""

import argparse
import base64
import io
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import cv2
from PIL import Image

from pipeline.clips import load_clips, parse_timestamp
from pipeline.config import CLIPS_CSV, THUMBNAIL_SRC_DIR
from pipeline.thumbnails import IMAGE_SUFFIXES, name_key

FRAMES_PER_CLIP = 8
# The clip itself is often a report read over footage, so look around it too.
WINDOW_PAD_S = 20.0
FRAME_EVERY_S = 1.5
# Faces in two frames are the same shot position if their centres are this close
# (as a share of frame width) and their sizes within this ratio.
SAME_SPOT_SHARE = 0.08
SAME_SIZE_RATIO = 1.33
# The crop is this many face widths across: head and shoulders, as in a lower third.
CROP_FACE_WIDTHS = 2.5
# Where the face's centre sits, as a share of the crop's height from the top.
FACE_HEIGHT_IN_CROP = 0.4
# Smaller faces are background: a monitor, a picture behind the desk, a wide shot.
MIN_FACE_SHARE = 0.05
# A second face at least this big (relative to the biggest) means a two-shot,
# where the biggest face may be the guest's.
TWO_SHOT_RATIO = 0.5

# A local vision model (Ollama) rejects recurring faces that aren't the presenter.
OLLAMA_URL = "http://localhost:11434/api/generate"
VISION_MODEL = os.environ.get("BRASS_VISION_MODEL", "gemma4:latest")
PRESENTER_PROMPT = ("This is a frame from a TV news broadcast. Is it a news presenter or reporter talking to the camera? "
                    "Answer no if it is a photograph, poster, painting, graphic, or footage of someone being reported on. "
                    "Answer with one word: yes or no.")
MAX_POSITIONS_CHECKED = 5

Box = tuple[int, int, int, int]  # x, y, width, height


@dataclass(frozen=True)
class Candidate:
    """One extracted frame and the faces found in it."""

    path: Path
    faces: list[Box]
    size: tuple[int, int]


def sampling_window(start: float, end: float, pad: float = WINDOW_PAD_S) -> tuple[float, float]:
    """The stretch of video to sample: the clip plus pad seconds either side, not before 0."""
    return max(0.0, start - pad), end + pad


def frame_offsets(duration: float, n: int = FRAMES_PER_CLIP) -> list[float]:
    """n times (seconds from the clip start) spread evenly inside the clip, none at its edges."""
    step = duration / (n + 1)
    return [round(step * (i + 1), 3) for i in range(n)]


def video_command(url: str, window: tuple[float, float], out_stem: Path) -> list[str]:
    """yt-dlp argv for the clip's stretch of a small video stream (frames only; quality doesn't matter)."""
    return [
        "yt-dlp", "-q", "--no-warnings", "-f", "bv*[height<=480]/b[height<=480]/bv*/b",
        "--download-sections", f"*{window[0]:.2f}-{window[1]:.2f}", "--force-keyframes-at-cuts",
        "-o", f"{out_stem}.%(ext)s", url,
    ]


def detect_faces(image: Path) -> list[Box]:
    """Frontal faces in an image, as plain-int boxes."""
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml")
    gray = cv2.equalizeHist(cv2.cvtColor(cv2.imread(str(image)), cv2.COLOR_BGR2GRAY))
    smallest = max(24, gray.shape[1] // 20)
    found = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(smallest, smallest))
    return [tuple(int(v) for v in box) for box in found]


def main_face(c: Candidate) -> Box | None:
    """The frame's one prominent face, or None for no face, only small ones, or a two-shot."""
    faces = sorted(c.faces, key=lambda b: b[2], reverse=True)
    if not faces or faces[0][2] < MIN_FACE_SHARE * c.size[0]:
        return None
    if len(faces) > 1 and faces[1][2] >= TWO_SHOT_RATIO * faces[0][2]:
        return None
    return faces[0]


def same_spot(a: Box, b: Box, frame_width: int) -> bool:
    """Whether two faces sit where the same camera shot would put them."""
    (ax, ay, aw, ah), (bx, by, bw, bh) = a, b
    dx, dy = (ax + aw / 2) - (bx + bw / 2), (ay + ah / 2) - (by + bh / 2)
    close = (dx * dx + dy * dy) ** 0.5 <= SAME_SPOT_SHARE * frame_width
    return close and max(aw, bw) / min(aw, bw) <= SAME_SIZE_RATIO


def rank_groups(candidates: list[Candidate]) -> list[list[tuple[Candidate, Box]]]:
    """Frames grouped by where their main face sits, most frequent position first (ties: bigger face).

    Each group is ordered biggest face first. Grouping is greedy, against each group's first face.
    """
    groups: list[list[tuple[Candidate, Box]]] = []
    for c in candidates:
        face = main_face(c)
        if face is None:
            continue
        for g in groups:
            if same_spot(g[0][1], face, c.size[0]):
                g.append((c, face))
                break
        else:
            groups.append([(c, face)])
    share = lambda cf: cf[1][2] / cf[0].size[0]
    for g in groups:
        g.sort(key=share, reverse=True)
    return sorted(groups, key=lambda g: (len(g), share(g[0])), reverse=True)


def pick_portrait(candidates: list[Candidate]) -> Candidate | None:
    """The biggest-face frame from the most frequent face position, or None if no frame has a clear face."""
    groups = rank_groups(candidates)
    return groups[0][0][0] if groups else None


def crop_portrait(candidate: Candidate, face: Box) -> Image.Image:
    """The head-and-shoulders square around a face in a frame."""
    with Image.open(candidate.path) as im:
        return im.convert("RGB").crop(crop_box(face, candidate.size))


def choose_portrait(
    candidates: list[Candidate], is_presenter: Callable[[Image.Image], bool | None],
) -> tuple[Image.Image, bool] | None:
    """The first face position, most frequent first, that is_presenter accepts.

    A recurring face can still be the wrong one: a photo held on screen through a
    report, a poster, a graphic. is_presenter returns None when it can't judge (no
    model available); then the most frequent position is used, marked unchecked.

    Returns:
        (crop, whether it was checked), or None if there's no face or every one was rejected.
    """
    groups = rank_groups(candidates)[:MAX_POSITIONS_CHECKED]
    for i, group in enumerate(groups):
        crop = crop_portrait(*group[0])
        verdict = is_presenter(crop)
        if verdict is None and i == 0:
            return crop, False
        if verdict:
            return crop, True
    return None


def ollama_is_presenter(image: Image.Image, model: str = VISION_MODEL) -> bool | None:
    """Ask a local vision model whether the crop shows a presenter talking to camera; None if it can't be reached."""
    buf = io.BytesIO()
    image.save(buf, "PNG")
    body = json.dumps({"model": model, "stream": False, "think": False, "prompt": PRESENTER_PROMPT,
                       "images": [base64.b64encode(buf.getvalue()).decode()]}).encode()
    request = urllib.request.Request(OLLAMA_URL, body, {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            answer = json.load(response).get("response", "")
    except (OSError, ValueError):
        return None
    return answer.strip().lower().startswith("yes")


def crop_box(face: Box, size: tuple[int, int]) -> tuple[int, int, int, int]:
    """A square (left, top, right, bottom) around the face, shifted to stay inside the frame."""
    x, y, w, h = face
    width, height = size
    side = min(round(w * CROP_FACE_WIDTHS), width, height)
    left = round(x + w / 2 - side / 2)
    top = round(y + h / 2 - FACE_HEIGHT_IN_CROP * side)
    left = min(max(left, 0), width - side)
    top = min(max(top, 0), height - side)
    return left, top, left + side, top + side


def missing_speakers(speakers: dict[str, str], folder: Path) -> dict[str, list[str]]:
    """Speakers with no picture in folder (matched ignoring case and accents), each with their clip ids."""
    have = {name_key(p.stem) for p in folder.glob("*") if p.suffix.lower() in IMAGE_SUFFIXES} if folder.is_dir() else set()
    out: dict[str, list[str]] = {}
    for cid, name in speakers.items():
        if name_key(name) not in have:
            out.setdefault(name, []).append(cid)
    return out


def extract_frames(video: Path, offsets: list[float], out_dir: Path) -> list[Path]:
    """One PNG per offset (seconds into the video); offsets past its end are skipped."""
    frames = []
    for i, t in enumerate(offsets):
        out = out_dir / f"frame{i:02d}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1", str(out)],
                       capture_output=True)
        if out.exists():
            frames.append(out)
    return frames


def portrait_from_clip(
    url: str, start: float, end: float, work: Path,
    is_presenter: Callable[[Image.Image], bool | None] = ollama_is_presenter,
) -> tuple[Image.Image, bool] | None:
    """Download the clip's video and crop the presenter's face: (crop, checked), or None if none was found."""
    stem = work / "video"
    window = sampling_window(start, end)
    result = subprocess.run(video_command(url, window, stem), capture_output=True, text=True)
    videos = [p for p in work.glob("video.*") if not p.name.endswith(".part")]
    if result.returncode != 0 or not videos:
        raise RuntimeError(f"yt-dlp failed: {(result.stderr or result.stdout).strip()[-200:]}")
    duration = window[1] - window[0]
    frames = extract_frames(videos[0], frame_offsets(duration, int(duration / FRAME_EVERY_S)), work)
    candidates = []
    for f in frames:
        with Image.open(f) as im:
            candidates.append(Candidate(f, detect_faces(f), im.size))
    return choose_portrait(candidates, is_presenter)


def main() -> int:
    """Fill in missing speaker pictures and list them for checking."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--csv", type=Path, default=CLIPS_CSV)
    args = parser.parse_args()
    clips = {c.id: c for c in load_clips(args.csv) if c.review_status != "rejected"}
    missing = missing_speakers({cid: c.speaker for cid, c in clips.items()}, THUMBNAIL_SRC_DIR)
    THUMBNAIL_SRC_DIR.mkdir(exist_ok=True)
    picked, failed = [], []
    for speaker, ids in missing.items():
        result = None
        for cid in ids:  # a speaker with several clips gets another chance if one has no clear face
            clip = clips[cid]
            with tempfile.TemporaryDirectory() as tmp:
                try:
                    result = portrait_from_clip(clip.url, parse_timestamp(clip.start), parse_timestamp(clip.end), Path(tmp))
                except RuntimeError as err:
                    print(f"  {cid}: {err}", file=sys.stderr)
            if result is not None:
                image, checked = result
                image.save(THUMBNAIL_SRC_DIR / f"{speaker}.png")
                picked.append(f"{speaker} (from {cid})" + ("" if checked else f", not checked: no {VISION_MODEL} in Ollama"))
                break
        if result is None:
            failed.append(speaker)
    print(f"portraits: {len(picked)} picked from video, {len(failed)} without a clear face", file=sys.stderr)
    for p in picked:
        print(f"  picked {p}: check it, and replace the thumbnails/ file by hand if it's wrong", file=sys.stderr)
    for s in failed:
        print(f"  warning: no clear face for {s}; add a screenshot to thumbnails/ by hand", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
