from pathlib import Path

from pipeline.sources import source_command


def test_source_command_downloads_only_the_padded_section_of_the_best_audio():
    cmd = source_command("https://youtu.be/X", (40.0, 175.0), Path("sources/clip1"))
    assert cmd[0] == "yt-dlp"
    assert cmd[cmd.index("-f") + 1] == "bestaudio"
    assert cmd[cmd.index("--download-sections") + 1] == "*40.00-175.00"
    assert cmd[cmd.index("-o") + 1] == "sources/clip1.%(ext)s"
    assert cmd[-1] == "https://youtu.be/X"


def test_source_command_cuts_precisely_rather_than_at_keyframes():
    # Without this, sections start at the previous keyframe: seconds of extra
    # audio (theme music, silence) end up at the head of the block, offsetting every cut.
    assert "--force-keyframes-at-cuts" in source_command("https://youtu.be/X", (0.0, 10.0), Path("s/c"))


def test_fetch_clip_cuts_from_the_cached_block_and_keeps_old_audio_on_failure(tmp_path):
    import numpy as np
    import pytest
    import soundfile as sf

    from pipeline.clips import load_clips
    from pipeline.fetch import fetch_clip
    from pipeline.sources import SourceUnavailable

    csv_path = tmp_path / "clips.csv"
    csv_path.write_text(
        "id,url,start,end,country,decade,year,genre,station,program,speaker,sex,recognizable,notes,date_confidence\n"
        "c,https://youtu.be/X,00:01:40,00:01:55,US,1970s,1978,news,CBS,CBS,W,m,maybe,,high\n")
    clip = load_clips(csv_path)[0]
    calls = []

    def download(url, window, out_stem):
        calls.append(window)
        out = out_stem.with_suffix(".wav")
        sf.write(out, np.zeros(int((window[1] - window[0]) * 8000)), 8000)
        return out

    raw, sources = tmp_path / "raw", tmp_path / "sources"
    raw.mkdir()
    fetch_clip(clip, raw, sources, download)
    y, sr = sf.read(raw / "c.wav")
    assert abs(len(y) / sr - 15.0) < 0.02
    assert calls == [(40.0, 175.0)]

    def gone(url, window, out_stem):
        raise SourceUnavailable("video removed")

    moved = load_clips(csv_path)[0].__class__(**{**clip.__dict__, "start": "00:10:00", "end": "00:10:15"})
    with pytest.raises(SourceUnavailable):
        fetch_clip(moved, raw, sources, gone)
    assert abs(len(sf.read(raw / "c.wav")[0]) / 8000 - 15.0) < 0.02  # previous audio still there


def test_refresh_recuts_only_clips_whose_times_changed_and_clears_their_stale_outputs(tmp_path):
    import numpy as np
    import soundfile as sf

    from pipeline.clips import load_clips
    from pipeline.fetch import refresh

    header = "id,url,start,end,country,decade,year,genre,station,program,speaker,sex,recognizable,notes,date_confidence\n"
    row = "{id},https://youtu.be/{id},{start},{end},US,1970s,1978,news,CBS,CBS,W,m,maybe,,high\n"
    csv_path = tmp_path / "clips.csv"

    def write_csv(a_start: str) -> list:
        csv_path.write_text(header + row.format(id="a", start=a_start, end="00:01:55")
                            + row.format(id="b", start="00:02:00", end="00:02:15"))
        return load_clips(csv_path)

    def download(url, window, out_stem):
        out = out_stem.with_suffix(".wav")
        sf.write(out, np.zeros(int((window[1] - window[0]) * 8000)), 8000)
        return out

    raw, processed, sources = tmp_path / "raw", tmp_path / "processed", tmp_path / "sources"
    assert refresh(write_csv("00:01:40"), raw, processed, sources, download) == ["a", "b"]
    assert refresh(write_csv("00:01:40"), raw, processed, sources, download) == []

    for kind in ("original", "trombone", "contours", "context", "thumbnails"):
        (processed / kind).mkdir(parents=True, exist_ok=True)
        for cid in ("a", "b"):
            (processed / kind / f"{cid}.x").write_text("old")

    assert refresh(write_csv("00:01:42"), raw, processed, sources, download) == ["a"]
    y, sr = sf.read(raw / "a.wav")
    assert abs(len(y) / sr - 13.0) < 0.02
    assert not (processed / "original" / "a.x").exists()   # stale: rebuilt by later stages
    assert not (processed / "trombone" / "a.x").exists()
    assert (processed / "context" / "a.x").exists()         # context is fetched on demand, not a build output
    assert (processed / "thumbnails" / "a.x").exists()      # thumbnails don't depend on the audio
    assert (processed / "original" / "b.x").exists()         # other clips untouched


def test_refresh_recuts_a_raw_file_with_no_record_of_its_times(tmp_path):
    import numpy as np
    import soundfile as sf

    from pipeline.clips import load_clips
    from pipeline.fetch import refresh

    csv_path = tmp_path / "clips.csv"
    csv_path.write_text(
        "id,url,start,end,country,decade,year,genre,station,program,speaker,sex,recognizable,notes,date_confidence\n"
        "a,https://youtu.be/a,00:01:40,00:01:55,US,1970s,1978,news,CBS,CBS,W,m,maybe,,high\n")
    raw = tmp_path / "raw"
    raw.mkdir()
    sf.write(raw / "a.wav", np.zeros(800), 8000)  # unknown provenance

    def download(url, window, out_stem):
        out = out_stem.with_suffix(".wav")
        sf.write(out, np.zeros(int((window[1] - window[0]) * 8000)), 8000)
        return out

    assert refresh(load_clips(csv_path), raw, tmp_path / "processed", tmp_path / "sources", download) == ["a"]
