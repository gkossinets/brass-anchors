"""Loading and interpreting the hand-curated clips.csv manifest."""

import csv
from dataclasses import dataclass
from pathlib import Path

from pipeline.config import DEFAULT_PITCH_RANGE, PITCH_RANGE_BY_SEX


# What the clip is doing, not the speaker's job: reporting news or arguing a view.
GENRES = ("news", "opinion")


@dataclass(frozen=True)
class Clip:
    """One row of clips.csv."""

    id: str
    url: str
    start: str
    end: str
    country: str
    decade: str
    year: int | None
    genre: str
    station: str
    program: str
    speaker: str
    sex: str
    recognizable: str
    notes: str
    date_confidence: str
    pitch_floor: float | None = None
    pitch_ceiling: float | None = None
    review_status: str = ""

    @property
    def pitch_range(self) -> tuple[float, float]:
        """Pitch floor/ceiling in Hz: explicit overrides, else defaults by speaker sex."""
        floor, ceiling = PITCH_RANGE_BY_SEX.get(self.sex.lower(), DEFAULT_PITCH_RANGE)
        return (self.pitch_floor or floor, self.pitch_ceiling or ceiling)


def parse_timestamp(value: str) -> float:
    """Convert 'HH:MM:SS', 'MM:SS', or plain seconds into seconds.

    Args:
        value: Timestamp string.

    Returns:
        Seconds as a float (an int-valued float for whole seconds).
    """
    seconds = 0.0
    for part in value.strip().split(":"):
        seconds = seconds * 60 + float(part)
    return seconds


def _optional_float(value: str | None) -> float | None:
    return float(value) if value and value.strip() else None


def load_clips(path: Path) -> list[Clip]:
    """Read clips.csv into Clip records, skipping blank and '#'-commented rows.

    Args:
        path: Path to the CSV.

    Returns:
        Clips in file order.

    Raises:
        ValueError: A row's genre isn't one of GENRES.
    """
    clips = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if not row.get("id") or row["id"].startswith("#"):
                continue
            year = row.get("year", "").strip()
            genre = row["genre"].strip()
            if genre not in GENRES:
                raise ValueError(f"{row['id']}: genre {genre!r} must be one of {GENRES}")
            clips.append(Clip(
                id=row["id"].strip(),
                url=row["url"].strip(),
                start=row["start"].strip(),
                end=row["end"].strip(),
                country=row["country"].strip(),
                decade=row["decade"].strip(),
                year=int(year) if year else None,
                genre=genre,
                station=row["station"].strip(),
                program=row["program"].strip(),
                speaker=row["speaker"].strip(),
                sex=row.get("sex", "").strip(),
                recognizable=row.get("recognizable", "").strip(),
                notes=row.get("notes", "").strip(),
                date_confidence=row.get("date_confidence", "").strip(),
                pitch_floor=_optional_float(row.get("pitch_floor")),
                pitch_ceiling=_optional_float(row.get("pitch_ceiling")),
                review_status=(row.get("review_status") or "").strip(),
            ))
    return clips
