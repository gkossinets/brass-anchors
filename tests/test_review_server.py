import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from pipeline.review import read_rows
from pipeline.review_server import ReviewConfig, make_server
from pipeline.sources import SourceUnavailable

CSV = """id,url,start,end,country,language,decade,year,genre,station,program,speaker,sex,recognizable,notes,date_confidence
a,https://youtu.be/A,00:01:00,00:01:15,US,en,1970s,1978,news,CBS,CBS Evening News,Walter Cronkite,m,maybe,,high
"""


@pytest.fixture
def server(tmp_path: Path):
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "review.html").write_text("<p>review</p>")
    csv_path = tmp_path / "clips.csv"
    csv_path.write_text(CSV)
    calls = {"rebuild": [], "context": [], "manifest": 0, "prepare": []}
    unavailable = set()

    def prepare(clip_id: str, url: str, start: float, end: float) -> None:
        calls["prepare"].append((clip_id, start, end))
        if start in unavailable:
            raise SourceUnavailable("video removed")

    def rebuild(clip_id: str) -> str:
        calls["rebuild"].append(clip_id)
        return f"rebuilt {clip_id}"

    def fetch_context(clip_id: str, url: str, window: tuple[float, float]) -> tuple[float, float]:
        calls["context"].append((clip_id, url, window))
        return window

    def build_manifest() -> str:
        calls["manifest"] += 1
        return "manifest ok"

    config = ReviewConfig(csv_path=csv_path, web_dir=tmp_path / "web", processed_dir=tmp_path / "processed",
                          rebuild=rebuild, fetch_context=fetch_context, build_manifest=build_manifest,
                          prepare=prepare)
    httpd = make_server(config, port=0)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    calls["unavailable"] = unavailable
    yield f"http://127.0.0.1:{httpd.server_address[1]}", csv_path, calls
    httpd.shutdown()


def get(url: str) -> dict:
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read())


def post(url: str, body: dict) -> tuple[int, dict]:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_lists_clips_with_their_csv_fields(server):
    base, _, _ = server
    clips = get(f"{base}/api/clips")["clips"]
    assert [c["id"] for c in clips] == ["a"]
    assert clips[0]["speaker"] == "Walter Cronkite"
    assert clips[0]["review_status"] == ""


def test_serves_the_review_page(server):
    base, _, _ = server
    with urllib.request.urlopen(f"{base}/review.html") as r:
        assert b"review" in r.read()


def test_metadata_edit_saves_without_rebuilding_audio(server):
    base, csv_path, calls = server
    status, body = post(f"{base}/api/clips/a", {"speaker": "W. Cronkite", "review_status": "approved"})
    assert status == 200
    assert body["rebuilt"] is False
    assert read_rows(csv_path)[1][0]["speaker"] == "W. Cronkite"
    assert calls["rebuild"] == []
    assert calls["manifest"] == 1  # genre or rejection changes must reach the game


def test_moving_the_segment_rebuilds_that_clip(server):
    base, _, calls = server
    status, body = post(f"{base}/api/clips/a", {"start": "00:01:02"})
    assert status == 200
    assert body["rebuilt"] is True
    assert calls["prepare"] == [("a", 62.0, 75.0)]
    assert calls["rebuild"] == ["a"]
    assert "rebuilt a" in body["log"]


def test_vanished_video_refuses_the_move_and_changes_nothing(server):
    base, csv_path, calls = server
    calls["unavailable"].add(5.0)
    before = csv_path.read_text()
    status, body = post(f"{base}/api/clips/a", {"start": "00:00:05", "end": "00:00:20"})
    assert status == 502
    assert "video removed" in body["error"]
    assert csv_path.read_text() == before
    assert calls["rebuild"] == []


def test_invalid_edit_is_refused_and_csv_untouched(server):
    base, csv_path, _ = server
    before = csv_path.read_text()
    status, body = post(f"{base}/api/clips/a", {"genre": "anchor"})
    assert status == 400
    assert "genre" in body["error"]
    assert csv_path.read_text() == before


def test_unknown_clip_is_404(server):
    base, _, _ = server
    status, _ = post(f"{base}/api/clips/zzz", {"speaker": "x"})
    assert status == 404


def test_context_fetches_padded_window_around_the_cut(server):
    base, _, calls = server
    status, body = post(f"{base}/api/clips/a/context", {})
    assert status == 200
    assert calls["context"] == [("a", "https://youtu.be/A", (55.0, 80.0))]
    assert body["window_start"] == 55.0
    assert body["clip_start"] == 60.0 and body["clip_end"] == 75.0
    assert body["audio"].startswith("audio/context/a.wav")


def _get_raw(url: str, headers: dict) -> tuple[int, dict, bytes]:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as r:
        return r.status, dict(r.headers), r.read()


def test_range_requests_get_partial_content_so_audio_can_seek(server, tmp_path):
    # Regression: without 206 responses Chrome can't seek in <audio>; it snaps to 0.
    base, _, _ = server
    payload = bytes(range(256)) * 40
    (tmp_path / "web" / "clip.wav").write_bytes(payload)
    status, headers, body = _get_raw(f"{base}/clip.wav", {"Range": "bytes=100-199"})
    assert status == 206
    assert headers["Content-Range"] == f"bytes 100-199/{len(payload)}"
    assert body == payload[100:200]
    status, headers, body = _get_raw(f"{base}/clip.wav", {"Range": "bytes=10000-"})
    assert status == 206 and body == payload[10000:]
    status, headers, body = _get_raw(f"{base}/clip.wav", {})
    assert status == 200 and headers["Accept-Ranges"] == "bytes" and body == payload


def test_files_must_be_revalidated_so_page_and_scripts_stay_in_step(server, tmp_path):
    # Regression: with no Cache-Control, Chrome reused a cached main.js against a
    # newer index.html and the page failed to load ("Cannot set properties of null").
    base, _, _ = server
    (tmp_path / "web" / "main.js").write_text("export {};")
    for path in ("/main.js", "/review.html"):
        _, headers, _ = _get_raw(f"{base}{path}", {})
        assert headers["Cache-Control"] == "no-cache"
    (tmp_path / "web" / "clip.wav").write_bytes(b"0123456789")
    _, headers, _ = _get_raw(f"{base}/clip.wav", {"Range": "bytes=2-5"})
    assert headers["Cache-Control"] == "no-cache"
