import csv
import io
from pathlib import Path

import pytest

from pipeline.review import context_window, read_rows, update_clip, validate_changes

CSV = """id,url,start,end,country,language,decade,year,genre,station,program,speaker,sex,recognizable,notes,date_confidence,pitch_floor,pitch_ceiling
a,https://youtu.be/A,00:01:00,00:01:15,US,en,1970s,1978,news,CBS,CBS Evening News,Walter Cronkite,m,maybe,"has ""quotes"", commas",high
b,https://youtu.be/B,10,25,UK,en,2010s,2019,news,BBC,Newsnight,Emily Maitlis,f,maybe,,high,100,380
"""


@pytest.fixture
def clips_csv(tmp_path: Path) -> Path:
    p = tmp_path / "clips.csv"
    p.write_text(CSV)
    return p


def test_update_changes_only_the_named_row_and_fields(clips_csv):
    update_clip(clips_csv, "a", {"speaker": "Walter Cronkite Jr.", "genre": "opinion"})
    header, rows = read_rows(clips_csv)
    assert rows[0]["speaker"] == "Walter Cronkite Jr."
    assert rows[0]["genre"] == "opinion"
    assert rows[0]["notes"] == 'has "quotes", commas'
    assert rows[1] == dict(zip(header, next(csv.reader(io.StringIO(CSV.splitlines()[2])))), **{"review_status": "", "review_notes": ""})


def test_review_columns_are_added_once_at_the_end(clips_csv):
    update_clip(clips_csv, "b", {"review_status": "approved", "review_notes": "sounds right"})
    update_clip(clips_csv, "a", {"review_status": "needs_fix"})
    header, rows = read_rows(clips_csv)
    assert header[-2:] == ["review_status", "review_notes"]
    assert header.count("review_status") == 1
    assert rows[1]["review_status"] == "approved"
    assert rows[1]["pitch_ceiling"] == "380"


def test_update_reports_whether_the_segment_moved(clips_csv):
    assert update_clip(clips_csv, "a", {"speaker": "x"}) is False
    assert update_clip(clips_csv, "a", {"start": "00:01:00"}) is False
    assert update_clip(clips_csv, "a", {"start": "00:01:02.5"}) is True


def test_update_unknown_clip_raises(clips_csv):
    with pytest.raises(KeyError):
        update_clip(clips_csv, "nope", {"speaker": "x"})


@pytest.mark.parametrize("changes, message", [
    ({"genre": "anchor"}, "genre"),
    ({"language": "de"}, "language"),
    ({"review_status": "maybe"}, "review_status"),
    ({"sex": "x"}, "sex"),
    ({"recognizable": "very"}, "recognizable"),
    ({"date_confidence": "sure"}, "date_confidence"),
    ({"start": "1:2:3:4"}, "start"),
    ({"start": "00:00:20", "end": "00:00:10"}, "end"),
    ({"start": "00:00:00", "end": "00:00:40"}, "40"),
    ({"id": "renamed"}, "id"),
    ({"year": "nineteen"}, "year"),
])
def test_validation_rejects_bad_values(changes, message):
    current = {"start": "00:01:00", "end": "00:01:15"}
    with pytest.raises(ValueError, match=message):
        validate_changes(current, changes)


def test_validation_accepts_a_normal_edit():
    validate_changes({"start": "00:01:00", "end": "00:01:15"},
                     {"start": "00:01:01.5", "end": "00:01:14", "genre": "news", "review_status": "approved", "year": ""})


def test_context_window_pads_and_clamps_at_zero():
    assert context_window(60.0, 75.0, pad=5) == (55.0, 80.0)
    assert context_window(2.0, 15.0, pad=5) == (0.0, 20.0)
