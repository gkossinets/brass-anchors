"""Reading, validating, and editing clips.csv rows for the review UI."""

import csv
import os
import re
import tempfile
from pathlib import Path

from pipeline.clips import GENRES, parse_timestamp

REVIEW_COLUMNS = ["review_status", "review_notes"]
REVIEW_STATUSES = ("", "unreviewed", "approved", "needs_fix", "rejected")
CHOICES = {
    "genre": GENRES,
    "review_status": REVIEW_STATUSES,
    "sex": ("", "m", "f"),
    "recognizable": ("", "unlikely", "maybe", "likely"),
    "date_confidence": ("", "high", "medium", "low"),
}
TIMESTAMP = re.compile(r"^\d+(:\d{1,2}){0,2}(\.\d+)?$")
MIN_SECONDS, MAX_SECONDS = 3.0, 30.0


def read_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    """Read clips.csv as a header plus one dict per row (missing trailing fields become "")."""
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = [dict(zip(header, r + [""] * (len(header) - len(r)))) for r in reader if r]
    return header, rows


def write_rows(path: Path, header: list[str], rows: list[dict[str, str]]) -> None:
    """Write rows atomically so a crash mid-write can't truncate clips.csv."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".csv")
    with os.fdopen(fd, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(header)
        writer.writerows([r.get(col, "") for col in header] for r in rows)
    os.replace(tmp, path)


def validate_changes(current: dict[str, str], changes: dict[str, str]) -> None:
    """Reject edits that would break the pipeline or the game.

    Args:
        current: The row as it is now (needs at least start and end).
        changes: Field -> new value.

    Raises:
        ValueError: Naming the offending field.
    """
    if "id" in changes:
        raise ValueError("id can't be changed from the review page")
    for field, allowed in CHOICES.items():
        if field in changes and changes[field] not in allowed:
            raise ValueError(f"{field} must be one of {[a for a in allowed if a]}")
    if changes.get("year") and not re.fullmatch(r"\d{4}", changes["year"]):
        raise ValueError("year must be four digits or empty")
    for field in ("start", "end"):
        if field in changes and not TIMESTAMP.match(changes[field]):
            raise ValueError(f"{field} must look like HH:MM:SS(.s), MM:SS, or seconds")
    start = parse_timestamp(changes.get("start", current["start"]))
    end = parse_timestamp(changes.get("end", current["end"]))
    if end <= start:
        raise ValueError("end must be after start")
    if not MIN_SECONDS <= end - start <= MAX_SECONDS:
        raise ValueError(f"segment is {end - start:.1f} s; keep it between {MIN_SECONDS:.0f} and {MAX_SECONDS:.0f} s")


def update_clip(path: Path, clip_id: str, changes: dict[str, str]) -> bool:
    """Validate and apply edits to one row of clips.csv.

    Adds the review columns on first use. Other rows and fields are untouched.

    Returns:
        True if the segment (start or end time) moved, so its audio must be rebuilt.

    Raises:
        KeyError: No row has this id.
        ValueError: An edit is invalid.
    """
    header, rows = read_rows(path)
    header += [c for c in REVIEW_COLUMNS if c not in header]
    row = next((r for r in rows if r["id"] == clip_id), None)
    if row is None:
        raise KeyError(clip_id)
    validate_changes(row, changes)
    moved = any(
        field in changes and parse_timestamp(changes[field]) != parse_timestamp(row[field])
        for field in ("start", "end")
    )
    row.update(changes)
    write_rows(path, header, rows)
    return moved


def context_window(start: float, end: float, pad: float = 5.0) -> tuple[float, float]:
    """The stretch of source video around a clip, for choosing boundaries by ear."""
    return max(0.0, start - pad), end + pad
