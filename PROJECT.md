# Project notes

Status, architecture, the reasons behind non-obvious choices, and what's next. How to install and use the project is in `README.md`; details live in the code and commit history.

## Status

Live at <https://brass-anchors.pages.dev>, with 20 reviewed English clips and two game modes. A third, Guess the language, is built (branch `languages`) and waits for French, Russian, and Mandarin clips. Play data and feedback are collected in Cloudflare D1. Tests: `make test` (pytest and `node --test`), all passing.

## Architecture

- **Pipeline** (`pipeline/`, Python): `clips.csv` → cached source audio → normalized clips → pitch and loudness contours → instrument renders → MP3s → `web/quiz.json` (answers, audio paths, speech stats). `make review` is a local page for checking and editing clips.
- **Game** (`web/`): static HTML and vanilla ES modules, no build step. Game rules live in pure `*-core.js` modules with tests beside them; the DOM modules are thin.
- **Server** (`functions/`, `server/`): Cloudflare Pages functions for `/api/log` (play data), `/api/stats` (the results page), `/api/feedback`, and ranged `/audio/*`. Checks and summaries are pure modules in `server/`, tested.
- **Deploy**: `make deploy` builds `dist/` (the game plus only the media `quiz.json` uses) and uploads it. `make stats` and `make feedback` read the live database.

## Key decisions

**Corpus and audio**
- Every clip has a required `language`. Match and Guess the clip play English (US and UK) only: in another language, the country and often the decade would be given away. Guess the language plays everything.
- Mandarin comes from mainland China only, so each non-English language maps to one country.
- `USSR/Russia` is one country label, because separate labels would give away the decade.
- Every clip is normalized to -23 LUFS, so loudness can't give a clip away.
- `yt-dlp --force-keyframes-at-cuts` is required: without it, cuts start at the previous keyframe and pick up seconds of theme music.
- Each clip keeps a cached block of its source audio (±60 s) in `sources/`, so uploads that vanish don't lose clips, and re-cuts take seconds. `raw/<id>.json` records each cut, so editing times in `clips.csv` triggers a re-cut.
- Synthesis follows the speaker's pitch and loudness only: no vibrato or reverb, which would add movement the speaker didn't make. Trombone is the default. Voices use cascaded formants; instruments use resonance peaks, because cascading made them sound muffled.
- The game plays 48 kbit/s CBR MP3 (exact seeking). Opus would be smaller, but older iPhones don't play it reliably. WAVs stay the pipeline's working files, and a stale MP3 keeps its clip out of the manifest.

**Game rules**
- Match scores one point per right pick (log format 3 on). It used to multiply by difficulty (1-3), but players couldn't tell the levels apart, so the labels went too. Match stats restart with format 3: older Match games stay in the database but are left out of the results. Difficulty still orders the pairs, closest last. It counts differences: country 1, news/opinion 1, decade 1, or 2 when the clips are 3 or more decades apart (those are easy to hear). Easy is 3+, medium 2, hard 1.
- No clip plays twice in a Match game, because a heard clip is recognizable by its opening. So a game is at most half as many rounds as there are clips. Pairing is a randomized backtracking search with restarts, which keeps the full easy-to-hard ramp.
- Stats for geeks use thresholds relative to each clip's own speech level, since recordings differ. The speaking rate is labelled rough (r = 0.57 against transcripts), and it's shown for English only, the language it was calibrated on.
- Guess the language takes rounds from each language in turn: English is the biggest set, so a draw from the whole pool would make "English" the safe guess. It opens at three languages; with two it's a coin flip. One point per round.

**Site and data**
- Cloudflare Pages + D1: one deploy for the site and its API, a generous free tier, and SQL for stats.
- Fonts are self-hosted, so visitors' browsers contact no third party.
- Pages answers HTTP Range requests with the whole file, and Safari may not play audio from such a server, so a function serves `/audio/*` with proper `206` responses.
- Each browser keeps a lasting random player ID. A 10-round Match game plays all 20 English clips, so later games are replays of familiar clips; the stats count **each player's first game only** (`make stats ALL=1` includes replays). The language game counts separately: a player's first language game counts even after a Match game, since it plays mostly other clips. Because a lasting ID can count as personal data, the privacy note says plainly that one is kept, rather than claiming "no personal data".
- Rounds are sent as they're answered, because many players won't finish or save.
- The feedback form asks for no contact details, so there's no email on the site and no way to reply.
- Defences against fake play data are cheap ones: impossible rounds are rejected, and a final score counts only if its rounds add up. A real per-sender rate limit isn't available to Pages Functions; it would mean moving the API to a Worker.

## Corpus

| | 1960s | 1970s | 1980s | 1990s | 2000s | 2010s | 2020s |
|---|---|---|---|---|---|---|---|
| news | 1 | 3 | 1 | 5 | 1 | 2 | 1 |
| opinion | – | – | – | 1 | 1 | 2 | 2 |

The table counts English clips only: 5 men and 5 women each for the US and UK.

Russian (added 2026-10-23, awaiting review): 5 men and 5 women, one each from the 1960s and 2020s and two from each decade between, except the 1970s, which has none. The official Soviet TV archive on YouTube has few 1970s anchors on camera. Sources are mostly official uploads (the state TV archive, *Vesti Nedeli*, TV Rain).

Set-aside clips are in `backburner/clips.csv`: a second Fiona Bruce, Levitan's 1961 radio announcement (hum and a steady tone; the pitch tracker loses most of it), and Kirillov's 1985 clip (one clip per speaker; the 1967 one is used).

Curation pitfalls, worth checking on each new clip's diagnostic plot:
- Censor bleeps, music beds, and mains hum: the pitch tracker latches onto them. `extract_contour` warns about steady tones. Official uploads are usually cleaner than re-uploads.
- Transcript timestamps can hide ad jingles and drift by seconds.
- Median pitch is a poor guide to sex: Fiona Bruce sits around 145-150 Hz.

## Known limitations

- Opinion clips are few (6 of 20) and none is older than 1994, so "opinion" hints "recent". Most hard rounds are "which decade?".
- `/api/stats` reads the whole events table on every view (Pages overrides our caching header). Fine at this scale.
- A player who opens the results page straight away may not see their game counted yet, because the browser can delay sending the last round. A reload fixes it.
- Tooltips (stat definitions) don't show on touch screens.
- A patient script could still post plausible fake games.

## Next steps

**Adding languages** (decided 2026-10-23): about 10 clips each of French, Russian (the 2 set-aside clips plus 8), and Mandarin (mainland China), aiming for 5 men and 5 women each and a spread of decades. Leads to check: INA's official YouTube channels (France, well dated); Gosteleradiofond and *Vremya*, NTV *Segodnya* (Russia); CCTV *Xinwen Lianbo* from 1978 (China, so no 1960s-70s). Watch for mains hum on old Soviet re-uploads and the *Xinwen Lianbo* music bed. News vs opinion doesn't matter for this mode, so genre balance isn't needed. Deploy after each language; the language card says "Coming soon" until there are three.

1. Older opinion clips (Eric Sevareid's CBS commentaries; *Firing Line* openings), keeping the 5/5/5/5 balance.
2. Compare trumpet and trombone on women's voices; possibly choose the default sound per clip.
3. Transcript-based speaking rate.
4. Tone languages vs stress languages: a README paragraph once the language game has data.
