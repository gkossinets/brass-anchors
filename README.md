# Brass Anchors

Can you tell a 1970s newsreader from a 2020s cable host by the melody of their voice alone?

Brass Anchors is a browser game built from 10 to 20 second clips of news anchors and commentators. Each voice is replaced by a synthesized instrument (a trombone by default, or an octave-up trumpet or a voice-like hum) that follows the speaker's pitch and loudness but carries no words. A live spectrogram draws the melody as it plays. After each answer you hear the original, with the speaker, programme, and a link to the source.

## What the game tests

Prosody is the suprasegmental layer of speech: fundamental frequency (pitch), intensity, timing, and pausing. The resynthesis keeps each speaker's pitch contour, loudness envelope, and timing, and discards the segmental content (vowels, consonants, words) along with channel cues such as recording bandwidth and noise. If players beat chance, they are using prosody. Three hypotheses:

- **Decade**: broadcast delivery has shifted over time in speaking rate, pitch level and range, and pause structure.
- **Country**: American and British English differ in intonation: which pitch patterns (rises, falls, fall-rises) speakers use and how often, and how wide their pitch range is.
- **News vs opinion**: reading news is a distinct register, with steady tempo, regular pitch declination within sentences, and pitch resets at sentence boundaries. Argued opinion should vary more in rate and pitch and pause less regularly.

The "Stats for geeks" panel shows several of these measures for each clip. The corpus is small (20 clips) and confounds speaker identity with each attribute, so results are suggestive at best. The play data the deployed site collects is meant to show which contrasts listeners can actually hear.

## Game modes

- **Match the description**: read a description ("Which of these is a **UK news report** from the **1970s**?"), play two clips, and pick the one that fits. Rounds ramp from easy (the clips differ in country, decade, and news vs opinion) to hard (they differ in one). The reveal shows "Stats for geeks" for both clips: average pitch, pitch range and variation, pauses per minute, and a rough speaking rate.
- **Guess the clip**: hear one clip and guess its decade, country, and whether it's news or opinion, with a station bonus. Variants: news-or-opinion only, and "same chair, different decade" (one country, decade only).

Options on the front page: number of rounds (10 by default), and pure mode, which leaves out speakers you might recognize by voice alone. The sound can be switched on every round screen.

On the deployed site, a results page (`stats.html`, linked from the end screen and the front page) shows everyone's results so far: the distribution of final scores with your own marked, accuracy and answer time by difficulty, and the easiest and hardest comparisons (Match) or clips (Guess the clip).

## How it works

A Python pipeline turns a list of YouTube sections (`clips.csv`) into game audio:

1. Cut each section from a cached block of the video's audio (yt-dlp, ffmpeg).
2. Normalize to mono 22.05 kHz at -23 LUFS, so loudness can't give a clip away.
3. Track pitch with Praat (parselmouth) and loudness per 10 ms frame.
4. Resynthesize: an additive engine renders harmonics on the pitch track, shaped by formants (hum) or brass resonances (trombone, trumpet), brighter as the speaker gets louder, silent wherever the speaker is.
5. Encode MP3s for the browser and write the manifest `web/quiz.json`.

The game is static HTML and vanilla JavaScript modules, with no build step and no framework. The source audio isn't in this repository: clone it, list clips in `clips.csv`, and the pipeline downloads and builds them.

## Quick start

Requirements: macOS or Linux with `yt-dlp`, `ffmpeg`, Python 3.11+, and Node 18+ (for the JavaScript tests and deploying).

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
make audio    # download, cut, analyse, synthesize, encode (a few minutes for 20 clips)
make serve    # then open http://localhost:8000
```

`make serve PORT=8001` uses another port. `?mode=match` or `?mode=classic` in the URL skips the front page.

## Pipeline

Every stage skips outputs that already exist, so reruns are cheap. Pass `-f` to a stage to redo it, e.g. `.venv/bin/python -m pipeline.synth -f -t hum`.

| Stage (`make` target) | Input | Output |
|---|---|---|
| `pipeline.fetch` (`fetch`) | `clips.csv` | `sources/<id>.*`: the section ±60 s, downloaded once; `raw/<id>.wav`: the exact section |
| `pipeline.trim_normalize` (`normalize`) | `raw/` | `processed/original/`: mono, 22.05 kHz, 50 ms fades, -23 LUFS |
| `pipeline.extract_contour` (`contours`) | `processed/original/` | `processed/contours/<id>.npz`, and `processed/diagnostics/<id>.png` (spectrogram with the pitch track) |
| `pipeline.synth` (`synth`) | contours | `processed/{trombone,brass,hum}/` |
| `pipeline.encode` (`encode`) | the WAVs above | an MP3 beside each (48 kbit/s CBR); re-encoded when a WAV changes |
| `pipeline.thumbnails` (`thumbs`) | `thumbnails/<Speaker>.png` | `processed/thumbnails/<id>.jpg` (optional speaker pictures) |
| `pipeline.build_manifest` (`manifest`) | `clips.csv`, audio, contours | `web/quiz.json`, including each clip's speech stats |

Changing a clip's times in `clips.csv` and running `make audio` re-cuts just that clip from its cached block: each cut records where it came from in `raw/<id>.json`. `sources/` holds the only local copy of each video's audio, and uploads can disappear, so back it up.

`extract_contour` warns about steady tones (pitch held within 10 cents for 0.3 s, which speech never does: usually a censor bleep or music), and `trim_normalize` warns when a cut's length differs from its section, which usually means a keyframe problem.

### clips.csv

`id,url,start,end,country,decade,year,genre,station,program,speaker,sex,recognizable,notes,date_confidence,pitch_floor,pitch_ceiling,review_status,review_notes`

- `start`, `end`: `HH:MM:SS`, `MM:SS`, or seconds, with optional decimals
- `genre`: `news` (reporting) or `opinion` (arguing a view). Label what the clip does, not the speaker's job
- `sex`: `m` or `f`; sets the pitch-tracking range (60-300 Hz or 100-500 Hz) unless `pitch_floor` and `pitch_ceiling` are given
- `recognizable`: `unlikely`, `maybe`, or `likely`; pure mode drops `likely`
- `date_confidence`: `high`, `medium`, or `low`
- `review_status`: empty, `unreviewed`, `approved`, `needs_fix`, or `rejected`; rejected clips are left out of the game
- Rows whose `id` starts with `#` are ignored

`backburner/clips.csv` holds clips set aside from the game; the pipeline reads only `clips.csv`.

### Speaker pictures

Put a screenshot of each speaker in `thumbnails/`, named as in the `speaker` column (`Walter Cronkite.png`). `make audio` makes small JPEGs for the reveal and warns about clips without a picture.

### Reviewing clips

`make review` serves a review page at <http://localhost:8001/review.html> (localhost only). For each clip: the original and the trombone, the pitch plot, and ±5 s of context around the cut with **Set start/end here** to choose boundaries by ear. Edits and a review status save straight into `clips.csv`; changed times re-cut and rebuild the clip in a few seconds, and the game updates.

`make check-pairs` reports how many easy, medium, and hard pairs the corpus supports for Match the description.

## Deploying

The site runs on Cloudflare Pages (free tier). The game is static files; `functions/api/log.js` stores anonymous play data in a D1 database.

First time:

```sh
npm install                                    # Wrangler, pinned in package.json
npx wrangler login
npx wrangler d1 create brass-anchors           # put the database_id it prints into wrangler.toml
make db-setup                                  # creates the events table
npx wrangler pages project create brass-anchors --production-branch main
make deploy                                    # prints the site's URL
```

`npm install` reports skipped install scripts for `esbuild` and `workerd`; they only verify binaries npm already installed, and Wrangler works without them.

Then:

- `make deploy` builds `dist/` (the game plus only the media `quiz.json` uses, about 8 MB) and uploads it. Run `make audio` first if clips changed.
- `make stats` reports players and games; Match accuracy and median answer time by difficulty, by what differed in hard rounds, and per clip pair; Guess-the-clip accuracy per question and per clip; and players' notes.
- `make site-dev` runs the deployable site locally with a local database at <http://localhost:8788/?collect=1>; `make stats LOCAL=1` reports on it.
- Safari needs HTTP Range support to play audio. After the first deploy, `curl -sI -H 'Range: bytes=0-99' https://<site>/audio/trombone/<id>.mp3` should answer `206`.

### What the deployed site records

Each answered round (the clips, the answer, right or wrong, plays per clip, time from first Play to answer, and the sound used), each finished game's score, and, if a player saves it, the game with their notes. Notes are never shown on the results page. Each browser gets a random player id. No names, accounts, or IP addresses are stored, and the front page says what's recorded. Collection is off on `localhost` unless the URL has `?collect=1`.

Anyone can post to `/api/log`, so the results are only as trustworthy as an open endpoint allows. The server rejects malformed or impossible rounds (unknown difficulty, points that don't match it, answers in under a second), and a game's final score counts in the distribution only when all its rounds arrived and add up to it. A patient script can still post plausible fake games; `make stats` shows the counts to watch.

## Repository layout

```
pipeline/    Python pipeline, review server, and site builder
web/         the game (and the local review page)
server/      validation, schema, and stats for collected play data
functions/   Cloudflare Pages function: POST /api/log
tools/       check-pairs and stats command-line reports
tests/       pytest suite (JavaScript tests sit beside their modules as *.test.js)
```

`PROJECT.md` has the design notes: why things are the way they are, known limitations, and ideas for what's next.

## Tests

```sh
make test     # pytest, then node --test
```

## About the clips

The clips are short excerpts of public broadcasts, used for non-commercial, educational play, and each reveal links to its source. No audio or video is stored in this repository. If you hold rights to a clip and want it removed from the game, please open an issue.

## License

The code is MIT licensed (see `LICENSE`). The license covers the code only, not the broadcast clips it downloads.
