"""Fixed settings shared by every pipeline stage.

These are deliberately global: every clip must go through identical processing
so the only thing that differs between synthesized renders is the speaker's delivery.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLIPS_CSV = ROOT / "clips.csv"
RAW_DIR = ROOT / "raw"
# Padded source blocks: the only local copy of each video's audio (see pipeline/sources.py)
SOURCES_DIR = ROOT / "sources"
# Speaker screenshots named "<Speaker>.png", supplied by hand
THUMBNAIL_SRC_DIR = ROOT / "thumbnails"
PROCESSED_DIR = ROOT / "processed"
ORIGINAL_DIR = PROCESSED_DIR / "original"
CONTOUR_DIR = ROOT / "processed" / "contours"
DIAGNOSTIC_DIR = ROOT / "processed" / "diagnostics"
WEB_DIR = ROOT / "web"

SAMPLE_RATE = 22050
TARGET_LUFS = -23.0
FADE_MS = 50
HOP_SECONDS = 0.01

PITCH_RANGE_BY_SEX = {"m": (60.0, 300.0), "f": (100.0, 500.0)}
DEFAULT_PITCH_RANGE = (60.0, 500.0)
