from pathlib import Path

from pipeline.build_manifest import build_manifest, youtube_link
from pipeline.clips import load_clips, parse_timestamp

CSV = """id,url,start,end,country,decade,year,genre,station,program,speaker,sex,recognizable,notes,date_confidence
us_a,https://www.youtube.com/watch?v=AAA,00:03:12,00:03:27,US,1970s,1974,news,CBS,CBS Evening News,Walter Cronkite,m,maybe,,high
ru_b,https://youtu.be/BBB,1:05,1:20,USSR,1980s,,opinion,Central TV,Mezhdunarodnaya Panorama,Valentin Zorin,m,unlikely,,low
uk_c,https://www.youtube.com/watch?v=CCC,10,25,UK,2020s,2022,opinion,TalkTV,Piers Morgan Uncensored,Piers Morgan,m,likely,,medium
"""


def write_csv(tmp_path: Path) -> Path:
    p = tmp_path / "clips.csv"
    p.write_text(CSV)
    return p


def test_parse_timestamp_accepts_hms_ms_and_seconds():
    assert parse_timestamp("00:03:12") == 192
    assert parse_timestamp("1:05") == 65
    assert parse_timestamp("10") == 10
    assert parse_timestamp("12.5") == 12.5


def test_youtube_link_adds_start_time_for_both_url_forms():
    assert youtube_link("https://www.youtube.com/watch?v=AAA", 192) == "https://www.youtube.com/watch?v=AAA&t=192s"
    assert youtube_link("https://youtu.be/BBB", 65) == "https://youtu.be/BBB?t=65s"


def test_manifest_contains_answers_audio_paths_and_link(tmp_path):
    clips = load_clips(write_csv(tmp_path))
    available = {"us_a", "ru_b", "uk_c"}
    m = build_manifest(clips, has_audio=lambda cid: cid in available)

    first = m["clips"][0]
    assert first["id"] == "us_a"
    assert first["answer"] == {
        "decade": "1970s", "country": "US", "genre": "news", "station": "CBS",
    }
    assert first["audio"] == {
        "original": "audio/original/us_a.mp3",
        "trombone": "audio/trombone/us_a.mp3",
        "brass": "audio/brass/us_a.mp3",
        "hum": "audio/hum/us_a.mp3",
    }
    assert first["link"] == "https://www.youtube.com/watch?v=AAA&t=192s"
    assert first["speaker"] == "Walter Cronkite"
    assert first["year"] == 1974
    assert first["recognizable"] == "maybe"
    assert m["clips"][1]["year"] is None


def test_manifest_can_exclude_low_confidence(tmp_path):
    clips = load_clips(write_csv(tmp_path))
    m = build_manifest(clips, has_audio=lambda cid: True, exclude_low_confidence=True)
    assert [c["id"] for c in m["clips"]] == ["us_a", "uk_c"]


def test_manifest_skips_clips_without_audio_and_reports_them(tmp_path):
    clips = load_clips(write_csv(tmp_path))
    m = build_manifest(clips, has_audio=lambda cid: cid != "ru_b")
    assert [c["id"] for c in m["clips"]] == ["us_a", "uk_c"]
    assert m["skipped"] == ["ru_b"]


def test_load_clips_rejects_genres_outside_news_and_opinion(tmp_path):
    import pytest

    p = tmp_path / "clips.csv"
    p.write_text(CSV.replace(",1974,news,CBS,", ",1974,anchor,CBS,"))
    with pytest.raises(ValueError, match="us_a.*anchor"):
        load_clips(p)


def test_manifest_leaves_out_rejected_clips(tmp_path):
    p = tmp_path / "clips.csv"
    lines = CSV.splitlines()
    p.write_text("\n".join([lines[0] + ",review_status,review_notes"] + [lines[1] + ",rejected,music bed"] + lines[2:]) + "\n")
    m = build_manifest(load_clips(p), has_audio=lambda cid: True)
    assert [c["id"] for c in m["clips"]] == ["ru_b", "uk_c"]


def test_manifest_includes_a_thumbnail_only_when_one_was_made(tmp_path):
    clips = load_clips(write_csv(tmp_path))
    m = build_manifest(clips, has_audio=lambda cid: True, has_thumbnail=lambda cid: cid == "us_a")
    assert m["clips"][0]["thumbnail"] == "audio/thumbnails/us_a.jpg"
    assert m["clips"][1]["thumbnail"] is None


def test_manifest_carries_rounded_speech_stats_when_available(tmp_path):
    clips = load_clips(write_csv(tmp_path))
    raw = {"median_hz": 141.42, "range_st": 10.81, "sd_st": 3.456, "syllables_per_s": 4.567,
           "pauses": 3, "pauses_per_min": 12.4, "mean_pause_s": 0.4271, "pause_pct": 12.6, "duration_s": 15.0}
    m = build_manifest(clips, has_audio=lambda cid: True, stats_for=lambda cid: raw if cid == "us_a" else None)
    assert m["clips"][0]["stats"] == {"median_hz": 141, "range_st": 10.8, "sd_st": 3.5, "syllables_per_s": 4.6,
                                      "pauses": 3, "pauses_per_min": 12, "mean_pause_s": 0.43, "pause_pct": 13,
                                      "duration_s": 15.0}
    assert m["clips"][1]["stats"] is None


def test_manifest_keeps_none_values_in_stats(tmp_path):
    clips = load_clips(write_csv(tmp_path))
    raw = {"median_hz": None, "range_st": None, "sd_st": None, "syllables_per_s": None,
           "pauses": 0, "pauses_per_min": 0, "mean_pause_s": None, "pause_pct": 0, "duration_s": 2.0}
    m = build_manifest(clips, has_audio=lambda cid: True, stats_for=lambda cid: raw)
    assert m["clips"][0]["stats"]["median_hz"] is None and m["clips"][0]["stats"]["pauses"] == 0
