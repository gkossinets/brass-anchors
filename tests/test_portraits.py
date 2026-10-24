from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from pipeline.portraits import (
    Candidate, choose_portrait, crop_box, detect_faces, frame_offsets, missing_speakers, pick_portrait, sampling_window,
    video_command,
)


def test_sampling_window_reaches_beyond_the_clip_but_not_before_the_video():
    assert sampling_window(100.0, 115.0) == (80.0, 135.0)
    assert sampling_window(5.0, 20.0) == (0.0, 40.0)


def test_frame_offsets_spread_inside_the_clip_away_from_its_edges():
    offsets = frame_offsets(10.0, 4)
    assert offsets == [2.0, 4.0, 6.0, 8.0]
    assert all(0 < t < 10 for t in frame_offsets(3.0, 8))


def test_video_command_asks_for_a_small_video_stream_of_just_the_clip():
    argv = video_command("https://youtu.be/X", (100.0, 115.5), Path("/tmp/x/v"))
    assert argv[0] == "yt-dlp"
    assert "*100.00-115.50" in argv
    fmt = argv[argv.index("-f") + 1]
    assert "height<=480" in fmt
    assert argv[-1] == "https://youtu.be/X"


def test_crop_is_a_square_around_the_face_with_room_for_shoulders():
    left, top, right, bottom = crop_box((300, 100, 80, 80), (1280, 720))
    assert right - left == bottom - top
    assert right - left == pytest.approx(80 * 2.5, abs=1)
    assert left < 300 and right > 380, "the face sits inside, horizontally centred"
    assert (left + right) / 2 == pytest.approx(340, abs=1)
    assert top < 100 and bottom > 180 + 40, "more room below the face than above"


def test_crop_shifts_to_stay_inside_the_frame():
    left, top, right, bottom = crop_box((5, 5, 100, 100), (640, 480))
    assert (left, top) == (0, 0)
    assert right - left == bottom - top == 250
    left, top, right, bottom = crop_box((560, 400, 70, 70), (640, 480))
    assert (right, bottom) == (640, 480)


def test_crop_never_exceeds_a_small_frame():
    left, top, right, bottom = crop_box((40, 40, 100, 100), (192, 144))
    assert right - left == bottom - top == 144
    assert left >= 0 and top == 0 and right <= 192 and bottom == 144


def cand(name: str, faces: list[tuple[int, int, int, int]]) -> Candidate:
    return Candidate(Path(name), faces, (1280, 720))


def test_pick_prefers_the_frame_with_the_biggest_single_face():
    best = pick_portrait([cand("a", [(0, 0, 60, 60)]), cand("b", [(0, 0, 120, 120)]), cand("c", [])])
    assert best.path == Path("b")


def test_pick_avoids_two_shots_where_two_faces_are_about_the_same_size():
    # An interview two-shot would put the wrong person's face in the thumbnail half the time.
    two_shot = cand("two", [(0, 0, 130, 130), (600, 0, 120, 120)])
    single = cand("one", [(0, 0, 90, 90)])
    assert pick_portrait([two_shot, single]).path == Path("one")
    # A small face in the background (a monitor, a picture behind the anchor) doesn't count against a frame.
    with_bg = cand("bg", [(0, 0, 130, 130), (900, 0, 30, 30)])
    assert pick_portrait([with_bg, single]).path == Path("bg")


def test_pick_prefers_the_face_that_keeps_coming_back_over_a_bigger_one_off():
    # The anchor returns to the same spot shot after shot; a cutaway to a newsmaker comes and goes.
    anchor = [cand(f"anchor{i}", [(600 + i, 200, 100, 100)]) for i in range(3)]
    cutaway = cand("cutaway", [(200, 100, 300, 300)])
    elsewhere = cand("elsewhere", [(100, 300, 105, 105)])
    best = pick_portrait([cutaway, *anchor, elsewhere])
    assert best.path.name.startswith("anchor")


def test_pick_ignores_faces_too_small_to_be_the_anchor():
    assert pick_portrait([cand("tiny", [(0, 0, 20, 20)])]) is None
    assert pick_portrait([]) is None


def test_missing_speakers_skips_those_with_a_screenshot_case_insensitively(tmp_path):
    (tmp_path / "walter cronkite.png").write_bytes(b"")
    speakers = {"us_a": "Walter Cronkite", "ru_b": "Igor Kirillov", "ru_c": "Igor Kirillov"}
    assert missing_speakers(speakers, tmp_path) == {"Igor Kirillov": ["ru_b", "ru_c"]}


def test_missing_speakers_count_a_screenshot_named_without_accents(tmp_path):
    (tmp_path / "Leon Zitrone.png").write_bytes(b"")
    assert missing_speakers({"fr_a": "Léon Zitrone"}, tmp_path) == {}


def test_detect_faces_finds_nothing_in_a_blank_frame(tmp_path):
    p = tmp_path / "blank.png"
    Image.new("RGB", (320, 240), "gray").save(p)
    assert detect_faces(p) == []


def test_detect_faces_returns_plain_int_boxes(tmp_path):
    # A crude drawn face won't reliably trigger the detector; the contract is the return type.
    p = tmp_path / "doodle.png"
    im = Image.new("RGB", (320, 240), "white")
    ImageDraw.Draw(im).ellipse((120, 60, 200, 160), fill="tan")
    im.save(p)
    faces = detect_faces(p)
    assert all(type(v) is int for box in faces for v in box)


def frames_on_disk(tmp_path: Path) -> list[Candidate]:
    """Two face positions: a recurring one (a newsmaker's photo held on screen) and a one-off (the anchor)."""
    out = []
    for name, face in [("photo1", (100, 100, 200, 200)), ("photo2", (102, 100, 200, 200)), ("anchor", (700, 150, 150, 150))]:
        path = tmp_path / f"{name}.png"
        Image.new("RGB", (1280, 720), "gray").save(path)
        out.append(Candidate(path, [face], (1280, 720)))
    return out


def test_choose_takes_the_most_frequent_face_the_checker_calls_a_presenter(tmp_path):
    asked = []

    def is_presenter(image: Image.Image) -> bool | None:
        asked.append(image.size)
        return len(asked) == 2  # rejects the recurring photo, accepts the anchor

    image, checked = choose_portrait(frames_on_disk(tmp_path), is_presenter)
    assert checked is True
    assert image.size == (375, 375), "the anchor's crop: 2.5 face widths"
    assert len(asked) == 2


def test_choose_without_a_checker_falls_back_to_the_most_frequent_face_unchecked(tmp_path):
    image, checked = choose_portrait(frames_on_disk(tmp_path), lambda im: None)
    assert checked is False
    assert image.size == (500, 500)


def test_choose_gives_up_when_the_checker_rejects_every_face(tmp_path):
    assert choose_portrait(frames_on_disk(tmp_path), lambda im: False) is None
    assert choose_portrait([], lambda im: True) is None
