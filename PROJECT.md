# Project notes

Status, architecture, the reasons behind non-obvious choices, and what's next. How to install and use the project is in `README.md`; details live in the code and commit history.

## Status

Live at <https://brass-anchors.pages.dev> (deployed 2026-10-24), with 50 reviewed clips: 20 English, 10 each of French, Russian, and Mandarin. Three games on the front page, easiest first: Guess the language (labelled "Easier"; English, French, Russian, or Mandarin), Match the clue (formerly Match the description), and Guess the clip. A clip stats page (`clips.html`) compares the clips' speech measurements by language, decade, and sex, and lists each game's hardest clips (built 2026-10-24). Play data and feedback are collected in Cloudflare D1. Tests: `make test` (pytest and `node --test`), all passing.

## Architecture

- **Pipeline** (`pipeline/`, Python): `clips.csv` → cached source audio → normalized clips → pitch and loudness contours → instrument renders → MP3s → `web/quiz.json` (answers, audio paths, speech stats). `make review` is a local page for checking and editing clips; it has its own plain stylesheet (`web/review.css`), not the game's.
- **Game** (`web/`): static HTML and vanilla ES modules, no build step. Game rules live in pure `*-core.js` modules with tests beside them; the DOM modules are thin.
- **Server** (`functions/`, `server/`): Cloudflare Pages functions for `/api/log` (play data), `/api/stats` (the results page), `/api/clip-stats` (the clip stats page's hardest clips), `/api/feedback`, and ranged `/audio/*`. Checks and summaries are pure modules in `server/`, tested.
- **Deploy**: `make deploy` builds `dist/` (the game plus only the media `quiz.json` uses) and uploads it. `make stats` and `make feedback` read the live database.

## Key decisions

**Corpus and audio**
- Every clip has a required `language`. Match and Guess the clip play English (US and UK) only: in another language, the country and often the decade would be given away. Guess the language plays everything.
- Mandarin comes from mainland China only, so each non-English language maps to one country.
- Every speaker must be named by a source, not guessed. *Xinwen Lianbo* anchors don't say their names on air, so a Mandarin clip needs on-screen name captions (common 2005-2013), an upload title or description naming the anchor, or a description naming the man-and-woman pair, in which case the voice's sex says which one is speaking. A face match against a named upload is the fallback (Kang Hui, Hai Xia), and it's recorded in the clip's notes.
- No anchor-commentary formats with a music bed (CCTV's *Zhubo Shuo Lianbo*): the pitch tracker follows the music, and the trombone goes wrong. Two such clips were replaced with ordinary newscast readings.
- `USSR/Russia` is one country label, because separate labels would give away the decade.
- Speaker pictures come from a hand-made screenshot when there is one; otherwise they're picked from the clip's video (the face that keeps returning to the same spot, with a local vision model rejecting graphics and newsmakers). Picks are wrong often enough (2 of 20 on the English clips) that each needs a tick in the review page's thumbnail OK box.
- Every clip is normalized to -23 LUFS, so loudness can't give a clip away.
- `yt-dlp --force-keyframes-at-cuts` is required: without it, cuts start at the previous keyframe and pick up seconds of theme music.
- Each clip keeps a cached block of its source audio (±60 s) in `sources/`, so uploads that vanish don't lose clips, and re-cuts take seconds. `raw/<id>.json` records each cut, so editing times in `clips.csv` triggers a re-cut.
- Synthesis follows the speaker's pitch and loudness only: no vibrato or reverb, which would add movement the speaker didn't make. Trombone is the default. Voices use cascaded formants; instruments use resonance peaks, because cascading made them sound muffled.
- Two sounds, trombone (default) and hum. The octave-up trumpet was dropped 2026-10-24: unused, and with three sounds the switch took two rows on a phone, pushing Reveal below the fold (Pixel 10). Phones also get 16px panel padding and gaps instead of 24px.
- The game plays 48 kbit/s CBR MP3 (exact seeking). Opus would be smaller, but older iPhones don't play it reliably. WAVs stay the pipeline's working files, and a stale MP3 keeps its clip out of the manifest.

**Game rules**
- Game names follow one pattern, "verb the noun", and each fits on one line of its front-page card. That's why Match the description became Match the clue; the card text still says "Read a description". The URL stays `?mode=match`.
- Guess the clip has one setting, clips from the UK, the US, or both, instead of three variants. With one country picked, the country question is left out. Station options come only from the clips the game plays, so a French or Russian station can't turn up as an obvious wrong answer.
- There's no "pure" mode (leaving out recognizable voices): it was rarely worth its checkbox.
- Reveal waits until the clip has been played, in every game (Match already required both clips): a guess made without listening says nothing about the voice and skews the stats. Answers can still be picked first.
- The station bonus in Guess the clip shows from the start of the round. It used to appear once the main questions were answered, which pushed Reveal down just as a phone player reached for it.
- Language buttons show codes (EN, FR, RU, ZH) in one row of equal buttons; the full names were too wide for one row on a phone. Screen readers and the hover title get the full name, and the reveal table spells it out.
- On every reveal, Next sits below the answer, flush right beside the round's score, where Reveal sits on the round screen; the original voice comes after.
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
- The clip stats page counts every game for its hardest-clips lists, replays included, unlike the results page: the owner wanted it to fill quickly. One list per game, because the games miss at very different rates and Match and Guess the clip play English only: pooled, the list would be all English clips. A miss: the wrong language; in Guess the clip, any asked question scored zero (a decade one off isn't a miss; the bonus doesn't count); in Match, a wrong pick counts against the clip that fit.
- The clip stats page charts pitch for women and men apart, always: pitch differs far more by sex than by language. Speaking rate stays off it (calibrated on English only).
- The feedback form asks for no contact details, so there's no email on the site and no way to reply.
- Defences against fake play data are cheap ones: impossible rounds are rejected, and a final score counts only if its rounds add up. A real per-sender rate limit isn't available to Pages Functions; it would mean moving the API to a Worker.
- Audio (2026-10-25): `/audio/*` answers 304 when the browser already has the clip, and keeps `max-age=0` so a re-cut clip reaches players at once. A clip that fails to load is retried once, then the button says "Couldn't load. Tap to try again"; each failure is logged as an `audio` event, and each round records how long its first play took to start (`ms_audio_start`). `make stats` reports both.

## Corpus

| | 1960s | 1970s | 1980s | 1990s | 2000s | 2010s | 2020s |
|---|---|---|---|---|---|---|---|
| news | 1 | 3 | 1 | 5 | 1 | 2 | 1 |
| opinion | – | – | – | 1 | 1 | 2 | 2 |

The table counts English clips only: 5 men and 5 women each for the US and UK.

French (reviewed 2026-10-24): 5 men and 5 women, one each from the 1960s, 1970s, 2010s, and 2020s, and two each from the 1980s to 2000s. Mostly France 2, plus Antenne 2, TF1, and RTF; 8 of the 10 come from INA's official uploads.

Russian (reviewed 2026-10-24, times trimmed in review): 5 men and 5 women, one each from the 1960s and 2020s and two from each decade between, except the 1970s, which has none. The official Soviet TV archive on YouTube has few 1970s anchors on camera. Sources are mostly official uploads (the state TV archive, *Vesti Nedeli*, TV Rain).

Mandarin (reviewed 2026-10-24): 5 men and 5 women, all CCTV *Xinwen Lianbo*: one from the 1990s (Xing Zhibin, 1996), three from the 2000s, four from the 2010s, and two from the 2020s. Kang Hui's clip is a CCTV editorial, so it's labelled opinion. Solemn readings were replaced (2026-10-24) because their slow, pause-heavy delivery came from the occasion, not the language, and dominated the clip stats standouts: Luo Jing's 1997 reading of Deng Xiaoping's death notice (43% silent) gave way to his 2008 newscast, and Du Xian's June 4, 1989 broadcast to Ouyang Xiadan (2019). That cost the 1980s: no other anchor from before 1996 could be named (Xue Fei speaks only a few lines in the one named 1989 broadcast; a 1991 upload credited to Zhang Hongmin is someone else's voice-over). Pan Tao's clip is about the 1911 Revolution anniversary, ending on a line against separatists; that was accepted. Scouting downloads and transcripts are in `candidates/zh/` (git-ignored).

Clips set aside (kept outside the repo): a second Fiona Bruce, Levitan's 1961 radio announcement (hum and a steady tone; the pitch tracker loses most of it), and Kirillov's 1985 clip (one clip per speaker; the 1967 one is used).

Curation pitfalls, worth checking on each new clip's diagnostic plot:
- Censor bleeps, music beds, and mains hum: the pitch tracker latches onto them. `extract_contour` warns about steady tones. Official uploads are usually cleaner than re-uploads.
- Transcript timestamps can hide ad jingles and drift by seconds.
- Median pitch is a poor guide to sex: Fiona Bruce sits around 145-150 Hz.
- Uploads disagree about who anchored: one title for the 1989-06-04 broadcast names Zhang Hongmin, but other uploads and the record say Xue Fei. Check names against a second source.
- Automatic speaker pictures went wrong 2 times in 9 on the Mandarin clips (a co-anchor; a politician in the report), so check every pick.

## Known limitations

- Opinion clips are few (6 of 20) and none is older than 1994, so "opinion" hints "recent". Most hard rounds are "which decade?".
- `/api/stats` reads the whole events table on every view (Pages overrides our caching header). Fine at this scale.
- A player who opens the results page straight away may not see their game counted yet, because the browser can delay sending the last round. A reload fixes it.
- Tooltips (stat definitions) don't show on touch screens.
- A patient script could still post plausible fake games.
- The audio failure count in `make stats` is a lower limit, not proof that audio is reliable. The commonest cause on phones is a lost or weak connection, and that same connection has to carry the report (retried once, after 2 seconds). So the failures that hurt players most are the likeliest to go unrecorded. The start-up times on each round (`ms_audio_start`) are the better sign of slow loading. If it matters, failed reports could be kept in the browser and sent with the next event that gets through.

## Next steps

**Adding languages** (decided 2026-10-23): French, Russian, and Mandarin are done and live (2026-10-24).

1. Named Mandarin anchors from the 1980s and 1990s reading ordinary news, to even out the decades (2010s has four clips). Leads: the 1988-07-13, 1989-05-17, and 1995-06-26 broadcasts have readings by unnamed anchors; an upload titled "1996 3 25 海霞" has Hai Xia in 1996 (she's the 2020s clip now).
2. Older opinion clips (Eric Sevareid's CBS commentaries; *Firing Line* openings), keeping the 5/5/5/5 balance.
3. Transcript-based speaking rate.
4. Tone languages vs stress languages: a README paragraph once the language game has data, now that Mandarin (a tone language) is in.
