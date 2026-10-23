# Design notes

Why things are the way they are, what's known to be weak, and what could come next. Usage is in `README.md`.

## Status

The pipeline and both game modes work end to end with 20 reviewed clips. Live at <https://brass-anchors.pages.dev> (Cloudflare Pages, deployed 2026-10-23) with anonymous play data in D1. Tests: 105 pytest and 95 `node --test`, all passing (`make test`).

## Corpus

20 clips: 5 men and 5 women each for the US and UK. US and UK only for now: the country question is a two-way choice, worth 1 point. Clips from other countries are set aside in `backburner/clips.csv`.

| | Men | Women |
|---|---|---|
| US | Cronkite (news, 1978), Rather (news, 1995), Rooney (opinion, 1994), Olbermann (opinion, 2009), Carlson (opinion, 2019) | Walters (news, 1977), Chung (news, 1994), Couric (news, 2007), Maddow (opinion, 2010), Ingraham (opinion, 2024) |
| UK | Dougall (news, 1967), Baker (news, 1981), Paxman (news, 1990), Morgan (opinion, 2023), Myrie (news, 2024) | Rippon (news, 1979), Stuart (news, 1992), Wark (news, 1993), Bruce (news, 2017), Maitlis (news, 2019) |

| | 1960s | 1970s | 1980s | 1990s | 2000s | 2010s | 2020s |
|---|---|---|---|---|---|---|---|
| news | 1 | 3 | 1 | 5 | 1 | 2 | 1 |
| opinion | – | – | – | 1 | 1 | 2 | 2 |

Skew: opinion is 6 of 20 and none is older than 1994, so "opinion" hints "recent". Older opinion candidates: Eric Sevareid's CBS commentaries (1970s) and the openings of Buckley's *Firing Line* (1960s-70s).

### Curation method

Download the first few minutes of a candidate, transcribe it (faster-whisper), and annotate each transcript line with its median pitch: that separates anchor from reporter, and men from women, at a glance. Pick a solo stretch, snap its edges to the quietest moment within ±0.35 s, build it, then re-transcribe the finished clip and check its diagnostic PNG for music beds, jingles, and hum. Whisper's segment times can drift by seconds; use word timestamps on the cut clip.

Problems found this way, worth watching for:
- A censor bleep (Maddow): becomes a long steady trombone note. The steady-tone warning catches it.
- Music under the voice (Rooney, and a third-party re-upload of Morgan): the pitch tracker latches onto it. Official uploads are cleaner.
- Mains hum at 60 Hz (Rooney): raise `pitch_floor` above it.
- An ad jingle hidden by transcript timestamps (Chung): visible in the diagnostic plot.
- Clipped first or last words: re-snap boundaries to pauses.
- Median pitch alone is a poor guide to sex: Fiona Bruce's voice sits around 145-150 Hz and was first taken for a man's.

## Audio

- **Loudness**: originals and every render at -23 LUFS, so loudness can't distinguish clips.
- **Precise cuts**: `yt-dlp --force-keyframes-at-cuts` is required; without it a section starts at the previous keyframe and gains 5-9 s of theme music. `trim_normalize` warns when a cut's length differs from its section by more than 0.5 s.
- **Source cache**: each clip keeps its video's audio for the section ±60 s in `sources/` (the original WebM/Opus or M4A stream, about 30 MB for 22 clips), with a JSON note of where the block sits in the video. Cuts come from the block; a download happens only when a cut falls outside it, into a temporary folder that replaces the old block only on success. So a vanished upload never loses a clip, and a re-cut takes about 4 s.
- **Re-cut detection**: `raw/<id>.json` records the URL and times of each cut; `fetch` re-cuts any clip whose record disagrees with `clips.csv` and clears its processed files so later stages rebuild it.
- **Pitch tracking**: Praat via parselmouth, 10 ms hop, range by sex unless overridden per clip. Contours store the range they were tracked with and are re-extracted when it changes (deleting that clip's renders). f0 is median-smoothed over 5 frames within voiced runs, never across pauses.
- **Steady-tone warning**: pitch held within 10 cents for 0.3 s or more, which speech never does.
- **Synthesis** (`TIMBRES` in `pipeline/synth.py`; the first entry is the game's default, and a test pins the order):
  - *trombone* (default): brass source with a wide dark-to-bright swing, broad peaks at 500 and 1100 Hz, at the speaker's pitch.
  - *brass* (shown as "Trumpet (octave up)"): +12 semitones, 12 harmonics, no resonances. Harder to hear as speech; possibly better for higher voices.
  - *hum*: neutral vowel with cascaded formants at 500/1500/2500/3500 Hz (Klatt model); its average spectrum tracks real speech up to about 3 kHz.
  - Voices use cascaded formants, which roll off above the top formant; instruments use peaks on a flat baseline, since cascading instrument resonances sounded muffled (a regression test guards the trombone).
  - Harmonic n has amplitude n^-slope, the slope moving from dark to bright as frame RMS rises from -45 to -15 dBFS. Silence wherever a frame is unvoiced or below -50 dBFS, with 8 ms ramps. No vibrato (pitch movement the speaker didn't make) and no reverb.
  - Re-tracking each render against its source contour: median error 5-9 cents, 91-96% of frames within 50 cents.
- **MP3 for the browser**: `pipeline/encode.py` writes an MP3 beside every WAV; the WAVs stay the working files for synthesis, stats, and review. 48 kbit/s constant bitrate (exact seeking; VBR can drift), about 100 KB per clip, 8 MB for the site against 56 MB of WAV. MP3 rather than WebM/Opus because older iPhones and iPads don't play Opus reliably. An MP3 older than its WAV is stale: the encoder redoes it, and the manifest leaves the clip out until then, so a re-render never plays old audio.
- **`USSR/Russia`** is a single country label: separate labels would leak the decade (before or after 1991). Descriptions still say "Soviet" up to 1991 and "Russian" after.

## Game

- **Static front end**: vanilla ES modules, no build. Rules live in pure modules tested with `node --test` (`quiz-core.js`, `match-core.js`, `log-core.js`, `spectrogram-math.js`, `collect-core.js`); the DOM modules are thin.
- **Routing**: the URL is the only source of truth for the mode. The front page's Play buttons set `?mode=`, so Back returns to the front page.
- **One audio element**: starting any clip stops the others.
- **Spectrogram**: Web Audio `AnalyserNode` (fftSize 4096) drawn on a canvas, log axis 60 Hz to 3 kHz, -95 to -25 dB. Each clip fills the width left to right, so the whole contour stays visible and synth and original can be compared. It shows only what the clip carries, so it gives nothing away. Once routed through the AudioContext, the audio element is only audible through it.
- **Sound memory**: the switch on each round screen remembers the choice (localStorage) for the next game.
- **Defaults**: 10 rounds; Match the description is listed first and its Play button has focus.
- **Results page** (`web/stats.html`, data from `GET /api/stats`): headline numbers, the score histogram, accuracy by difficulty and by what differed, and the five easiest and hardest comparisons (Match) or clips (Guess the clip). A comparison or clip needs 3 attempts to be ranked, and the easiest and hardest lists never share an entry. The end screen links to it with the player's score (`?mode=match&you=70`), which is marked on the histogram. The line under it says "Your score: 65% of the maximum points" and ranks it among *other* players' games: one copy of your score is left out (your game is usually already counted), ties count half, so matching everyone else is the 50th percentile, and with no one else it says there's nothing to compare with yet. (The first version said "higher than 0% of finished games" when the only game was the player's own.) The histogram is one series, so no legend; your bin is the accent colour and the rest a lighter step of the same hue (validated as an ordinal pair against the card surface in both themes). Bars carry hover and focus tooltips, and a table view repeats the data. It's redrawn at the width available, so labels stay legible on a phone. No notes and no ids are published. Guess-the-clip clips are ranked by the share of questions answered with full marks, which compares variants that ask different questions.

- **Visual design: Broadcast brass** (mocks in `design/broadcast-brass/`, one static HTML page per screen, dark scheme only): a night newsroom (navy, brass, Oswald capitals, IBM Plex Mono for data, Source Sans for body) by default, and a daytime scheme from `prefers-color-scheme: light`; every colour is a token in `web/style.css`, and brass appears on pale backgrounds only as a fill or thick border (dark brass `--accent-text` otherwise). From data the game already had: a header with round segments and the running score (on air / off air elsewhere), lower-third captions ("FIND" + the description; the classic reveal's points, thumbnail, speaker, and programme), "● Playing · 0:07" card status and a classic timer (`play()` takes an optional status callback), the "Right, +2" tag, points notes on question titles, ✓ / ◐ one off / ✕ / — beside guesses so colour is never the only signal, "N of M possible", and the split end score. Pure helpers live in `web/display-core.js`, `quiz-core.js` (`pointsNote`, `guessMark`), and `match-core.js` (`findPhrase`). Departures from the mocks: the front page's heading is just "Brass Anchors" (64px), without the "Tonight's broadcast" eyebrow or the two-line "The news, played on a trombone." hero, which took a lot of space for little; the mode cards' strips say what each mode is and how long the game will be ("Two clips a round · 10 rounds", "One clip a round · 10 rounds") instead of the mocks' "Recommended" and "Classic", with round counts following the Rounds box and the clips available; play buttons keep Play/Stop text without icons; no playhead line on the spectrogram. The results chart's bar colours were re-validated against the new cards (dark: `#6F6230` and brass; light: brass and `#7F6209`, since any tint lighter than brass fails the 2:1 floor on white). Fonts are self-hosted in `web/fonts/` (Latin subsets from Google Fonts, 70 KB for all four files, SIL Open Font License 1.1 with each font's licence alongside), so no visitor's browser contacts Google: loading them from Google Fonts would have sent every visitor's IP address there, contradicting the front page's privacy note. `build_site` copies asset folders like `fonts/` whole.

### Match the description

- A distractor differs from the correct clip in at least one of country, decade, and news vs opinion, so it never fits the description.
- Difficulty counts weighted differences: country 1, news/opinion 1, decade 1, or 2 when the clips are 3 or more decades apart (`decadeFarGap`), since 1967 vs 2024 is far easier to hear than 1995 vs 2007. Easy is 3 or more, medium 2, hard 1. Points: easy 1, medium 2, hard 3.
- The ramp: 30% easy, 30% hard, the rest medium (5 rounds: 2/2/1).
- A same-speaker distractor is allowed only at hard, and other speakers are preferred even then. No clip is heard twice in a game, as the right answer or the other one: once heard, a clip is easy to recognize by its opening (the trombone Tucker Carlson, say). So a game has at most half as many rounds as there are clips (10 from 20; 9 in pure mode), and the front page says so. Pairing is a randomized backtracking search that fills the hard rounds first (their pairs are scarcest) and restarts after 2,000 steps, up to 30 times; on the real corpus all 1,000 test games got the full 3/4/3 ramp with no fallbacks, at under 1 ms each. The correct side is random. Picking unlocks once both clips have been started.
- If no pair is left at the scheduled level, the round falls back to an easier level first, then a harder one, and the fallback is recorded.
- `MATCH_CONFIG` in `web/match-core.js` holds the wording and scoring knobs. `make check-pairs` uses the same module, so the report and the game can't disagree. With 20 clips: 142 easy, 136 medium, and 88 hard ordered pairs, and every clip has a partner at every level.

### Stats for geeks

Computed from each clip's contour by `pipeline/stats.py`, rounded into the manifest, and formatted by `geekStatsRows`. Thresholds are relative to each clip's own speech level, since noise floors range from -36 to -43 dB across recordings. Definitions are hover tooltips (`title` attributes, so not on touch screens). The two reveal cards share a CSS subgrid so their sections line up.

- Average pitch (median Hz), pitch range (5th-95th percentile in semitones), and pitch variation (SD in semitones).
- Pauses: unvoiced stretches at least 15 dB below speech level, 0.2 s or longer, excluding the clip's edges. Shown per minute, because clips run 12-24 s, plus the average pause length.
- Speaking rate (rough): voiced loudness peaks per second of speaking time, scaled by `SYLLABLE_CALIBRATION` (1.25). Against syllable counts from transcripts of the 20 clips: r = 0.57, median error 6%. It's tuned on those same clips, so treat small differences between two clips as noise. Transcript-based words per minute would be the reliable upgrade.

### Log format

Shared by both modes (`format: 2`). A game record has `mode`, `settings`, `rounds`, and `cues` (the player's notes). Each round has `mode`, `round`, `clip_ids`, `plays` (per clip), `ms_first_play_to_answer`, and `timbre`; classic adds `guess`, `score`, and `timbres_heard`; match adds `difficulty`, `requested_difficulty`, `differs`, `decade_gap`, `correct_id`, `distractor_id`, `correct_side`, `pick`, `right`, and `points`.

## Deployment and play data

- **Cloudflare Pages + D1**: one deploy covers the site and the endpoint, the free tier is far beyond a game shared among friends, and the stats are SQL.
- **Site build**: `pipeline/build_site.py` copies the game (minus the review page and tests) and real copies of just the media `quiz.json` refers to into `dist/`, failing if any is missing.
- **Collection**: `web/collect.js` sends each round as it's answered, via `sendBeacon` so the last one survives a closed tab, because many players won't finish or save. Save sends the whole game with notes. Sending is best-effort and never blocks play. Off on localhost unless `?collect=1`.
- **Validation**: `server/collect-core.js` checks every event (kind, mode, UUID ids, round range, 64 KB body, 4000-character notes) before `functions/api/log.js` inserts it.
- **Privacy**: the front page says "This site does not collect personal data" and that it records only anonymous gameplay results, and the design keeps that true. Each game gets fresh random ids (an earlier version kept a lasting player id per browser, which links one person's games and can count as personal data under GDPR; it is deleted from the browser on the next visit). No names, accounts, or IP addresses are stored; the notes box asks players not to include names or contact details; nothing loads from third parties. So the stats count games and rounds, not players; rows collected before this change still carry the old lasting ids, unused. Cloudflare sees visitors' addresses in serving the pages, as any host does; the site adds no analytics.
- **Stats**: `server/stats-core.js` de-duplicates rounds per game and round, takes each game's latest record (sent when it finishes, and again on Save with notes), and treats pairs as unordered.
- **Fake results**: the endpoint is open and the repo documents the format, so anyone could post made-up games. Cheap defences are in place: `collect-core.js` rejects impossible rounds (unknown difficulty, points that don't match it, a clip id outside `[a-z0-9_]`, answers under a second), and a final score enters the distribution only when rounds 1 to N all arrived and their points add up to it, so a single forged record can't move it (`make stats` counts those it left out). A script that posts consistent rounds still gets through. Cloudflare's rate-limiting binding isn't available to Pages Functions (Workers only), so a real per-sender limit would mean moving the API to a Worker, possibly with Turnstile (an invisible bot check) at game start.
- **`/api/stats`** reads the whole events table per request. It asks for a minute of caching, but Pages replaces the header with `max-age=0, must-revalidate` (seen locally and live), so every page view queries D1. Fine at this scale; cache in KV or aggregate in SQL if it grows.
- **Late rounds**: rounds go out by `sendBeacon`, which a browser may delay; in the live check, round 2 of 3 arrived 4 s after the game's finish record. A player who opens the results page at once can find their game not yet counted (its rounds don't all add up yet); it counts on reload.
- **Caching**: Pages serves files with `max-age=0, must-revalidate`, and the local server sends `no-cache`, so a browser never mixes a new page with old scripts.
- **Range requests**: browsers need HTTP Range to seek in audio, and Safari opens `<audio>` with a `bytes=0-1` probe and may not play from a server that ignores it. Pages answers Range with a full `200` (its docs say `206` support is in progress), so `functions/audio/[[path]].js` fetches the file from the static assets and slices it (`server/range.js`, tested): live, a `bytes=0-1` request gets a 2-byte `206`. It costs one function invocation per audio request (free tier: 100,000 a day). `pipeline/static_server.py` does the same for `make serve` and `make review`.

## Known limitations

- Hard rounds are mostly "which decade?" (70% of hard pairs), so the hard-round breakdown says little about country or news vs opinion. More opinion clips across decades, and same-decade US/UK pairs, would balance it.
- 14 of 20 clips are news, so most prompts say "news report".
- No speaker has two clips in the game, so same-speaker hard pairs are untested on real data.
- Tooltips don't show on touch screens.
- Fake results: see "Fake results" above.

## Ideas

1. Compare trumpet and trombone on the women's clips; if trumpet works better, choose the default sound per clip from the `sex` column.
2. Older opinion clips, keeping the 5/5/5/5 balance.
3. Transcript-based speaking rate.
4. Other countries (the backburner has Soviet and Russian clips).
5. A MIDI-rendered "hard mode" (the manifest's `audio` dict can take a new key).
