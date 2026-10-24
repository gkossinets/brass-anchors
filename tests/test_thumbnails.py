from pathlib import Path

from PIL import Image

from pipeline.thumbnails import THUMB_WIDTH, make_thumbnail, match_thumbnails


def touch_png(path: Path, size: tuple[int, int] = (1280, 720), mode: str = "RGBA") -> None:
    Image.new(mode, size, (200, 30, 30, 255) if mode == "RGBA" else (200, 30, 30)).save(path)


def test_screenshots_match_clips_by_speaker_name_ignoring_case(tmp_path):
    touch_png(tmp_path / "Walter Cronkite.png")
    touch_png(tmp_path / "fiona bruce.PNG")
    touch_png(tmp_path / "Nobody Here.png")
    speakers = {"us_cronkite": "Walter Cronkite", "uk_bruce": "Fiona Bruce", "uk_newsnight": "Newsnight presenter (unidentified)"}

    matches, missing, unused = match_thumbnails(speakers, tmp_path)

    assert matches == {"us_cronkite": tmp_path / "Walter Cronkite.png", "uk_bruce": tmp_path / "fiona bruce.PNG"}
    assert missing == ["uk_newsnight"]
    assert unused == ["Nobody Here.png"]


def test_screenshots_match_whether_or_not_the_name_has_its_accents(tmp_path):
    # Typing "Leon" for "Léon" is easy, and macOS may store "é" decomposed (e + combining accent).
    touch_png(tmp_path / "Leon Zitrone.png")
    touch_png(tmp_path / "Beatrice Scho\u0308nberg.png")
    speakers = {"fr_zitrone": "Léon Zitrone", "fr_schonberg": "Béatrice Schönberg"}
    matches, missing, unused = match_thumbnails(speakers, tmp_path)
    assert set(matches) == {"fr_zitrone", "fr_schonberg"} and not missing and not unused


def test_one_speaker_with_two_clips_uses_the_same_screenshot(tmp_path):
    touch_png(tmp_path / "Fiona Bruce.jpg", mode="RGB")
    matches, missing, unused = match_thumbnails({"a": "Fiona Bruce", "b": "Fiona Bruce"}, tmp_path)
    assert matches["a"] == matches["b"] and not missing and not unused


def test_thumbnail_is_a_small_rgb_jpeg_keeping_the_aspect_ratio(tmp_path):
    src = tmp_path / "s.png"
    touch_png(src, (1280, 720))
    dst = tmp_path / "out" / "c.jpg"
    make_thumbnail(src, dst)
    im = Image.open(dst)
    assert im.format == "JPEG" and im.mode == "RGB"
    assert im.size == (THUMB_WIDTH, round(THUMB_WIDTH * 720 / 1280))
    assert dst.stat().st_size < 30_000


def test_small_screenshots_are_not_upscaled(tmp_path):
    src = tmp_path / "s.png"
    touch_png(src, (192, 144))
    make_thumbnail(src, tmp_path / "c.jpg")
    assert Image.open(tmp_path / "c.jpg").size == (192, 144)
