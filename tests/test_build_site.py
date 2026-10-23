import json
from pathlib import Path

import pytest

from pipeline.build_site import build_site, referenced_files


def manifest(clips: list[dict]) -> dict:
    return {"timbres": [{"id": "trombone", "label": "Trombone"}], "clips": clips}


def clip(cid: str, thumbnail: bool = True) -> dict:
    return {
        "id": cid,
        "audio": {"original": f"audio/original/{cid}.wav", "trombone": f"audio/trombone/{cid}.wav"},
        "thumbnail": f"audio/thumbnails/{cid}.jpg" if thumbnail else None,
    }


@pytest.fixture
def web(tmp_path: Path) -> Path:
    """A web/ folder like the real one: game files, review tool, tests, and audio -> ../processed."""
    web = tmp_path / "web"
    web.mkdir()
    for name in ("index.html", "main.js", "style.css", "match-core.js",
                 "review.html", "review.js", "review-core.js", "review.css", "match-core.test.js"):
        (web / name).write_text(name)
    processed = tmp_path / "processed"
    for sub in ("original", "trombone", "thumbnails", "contours", "context"):
        (processed / sub).mkdir(parents=True)
    for cid in ("a", "b"):
        (processed / "original" / f"{cid}.wav").write_bytes(b"orig" + cid.encode())
        (processed / "trombone" / f"{cid}.wav").write_bytes(b"trom" + cid.encode())
        (processed / "thumbnails" / f"{cid}.jpg").write_bytes(b"jpg")
        (processed / "contours" / f"{cid}.npz").write_bytes(b"npz")
        (processed / "context" / f"{cid}.wav").write_bytes(b"context")
    (processed / "original" / "shelved.wav").write_bytes(b"not in the manifest")
    (web / "audio").symlink_to("../processed")
    (web / "quiz.json").write_text(json.dumps(manifest([clip("a"), clip("b", thumbnail=False)])))
    return web


def test_referenced_files_are_every_audio_path_and_thumbnail(web):
    m = json.loads((web / "quiz.json").read_text())
    assert referenced_files(m) == [
        "audio/original/a.wav", "audio/thumbnails/a.jpg", "audio/trombone/a.wav",
        "audio/original/b.wav", "audio/trombone/b.wav",
    ]


def test_site_has_the_game_and_only_the_media_it_plays(web, tmp_path):
    out = tmp_path / "dist"
    summary = build_site(web, out)

    files = sorted(str(p.relative_to(out)) for p in out.rglob("*") if p.is_file())
    assert files == [
        "audio/original/a.wav", "audio/original/b.wav", "audio/thumbnails/a.jpg",
        "audio/trombone/a.wav", "audio/trombone/b.wav",
        "index.html", "main.js", "match-core.js", "quiz.json", "style.css",
    ]
    # Real copies, not links back into processed/: the upload must not depend on local paths.
    assert not any(p.is_symlink() for p in out.rglob("*"))
    assert (out / "audio" / "trombone" / "b.wav").read_bytes() == b"tromb"
    assert summary["files"] == 10 and summary["media_files"] == 5


def test_rebuilding_replaces_a_stale_site(web, tmp_path):
    out = tmp_path / "dist"
    build_site(web, out)
    (out / "leftover.js").write_text("old")
    build_site(web, out)
    assert not (out / "leftover.js").exists()


def test_missing_media_fails_loudly_instead_of_shipping_a_broken_game(web, tmp_path):
    (web / "audio" / "trombone" / "b.wav").unlink()
    with pytest.raises(FileNotFoundError, match="audio/trombone/b.wav"):
        build_site(web, tmp_path / "dist")


def test_refuses_to_build_into_the_source_folder(web):
    with pytest.raises(ValueError):
        build_site(web, web)


def test_asset_folders_such_as_fonts_are_copied_whole(web, tmp_path):
    (web / "fonts").mkdir()
    (web / "fonts" / "oswald-latin.woff2").write_bytes(b"wOF2font")
    (web / "fonts" / "OFL.txt").write_text("licence")
    out = tmp_path / "dist"
    summary = build_site(web, out)
    assert (out / "fonts" / "oswald-latin.woff2").read_bytes() == b"wOF2font"
    assert (out / "fonts" / "OFL.txt").exists()
    assert summary["files"] == 12
