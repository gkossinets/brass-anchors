# Visual design: Broadcast brass

Instructions for restyling the game (`web/index.html`, `web/style.css`, and the markup the screen modules build) in the look Gregory chose on 2026-10-23. The game's behaviour, rules, and tests stay as they are; this is a skin plus a few small display additions, listed under "New on screen" below.

Reference mocks, one per screen, are in `design/broadcast-brass/` (open them in a browser; they are static HTML with inline styles and placeholder data in [brackets]). The mocks are the source of truth for layout and spacing; this file is the source of truth for tokens and rules. The editable canvas is https://claude.ai/artifact/AuV8Z6CTz8KgTBhfTbuLu5 (private to Gregory).

## The idea

A 1970s network newsroom at night: deep navy, brass accents, tall condensed capitals, and on-screen captions in the style of a TV lower third (a solid tag plus a light caption bar). It plays on the name and on the game's subject, decades of broadcast news. Keep it restrained: one accent colour, no gradients, no glow, no textures.

## Tokens

Replace the `:root` variables in `web/style.css`. The design is dark only: drop the light scheme and the `prefers-color-scheme` block (broadcast navy is the identity, not a theme).

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0E1726` | page |
| `--card` | `#16233A` | cards, panels |
| `--well` | `#0A111D` | spectrogram and stats wells inside cards |
| `--line` | `#2A3A56` | rules, empty progress, inactive round segments |
| `--line-strong` | `#3A4C6B` | outlines of secondary buttons, inputs, segmented controls |
| `--fg` | `#F2EBDD` | text; also the light caption bar background |
| `--fg-soft` | `#C9D1DE` | body copy on cards |
| `--muted` | `#A9B3C4` | labels, meta text, timers |
| `--accent` | `#C9A227` | brass: primary buttons, chosen answers, playing state, tags |
| `--accent-ink` | `#0E1726` | text on brass or on the light caption bar |
| `--good` | `#6FCF97` | "Matches", correct guesses (text) |
| `--good-solid` | `#3E9C6B` | the "Right, +N" tag and the matching card's outline |
| `--part` | `#C9A227` | partly right (decade one off); pair it with a "one off" note, not colour alone |
| `--bad` | `#F08A74` | "Doesn't match", wrong values, errors |
| `--live` | `#E2533A` | the small "On air" dot only |

All text pairs above pass 4.5:1 on `--bg` and `--card`. Never put `--muted` on brass.

## Type

Three families from Google Fonts (one `<link>` in `index.html`, `display=swap`); fallbacks keep the layout if offline.

- Display: Oswald 500/600/700, `"Oswald", "Arial Narrow", sans-serif`. Headings, buttons, card letters, question titles, table row labels. Usually uppercase with `letter-spacing: 0.06em` to `0.12em`.
- Body: Source Sans 3 400/600, `"Source Sans 3", system-ui, sans-serif`. Descriptions, option labels, the cues textarea.
- Data: IBM Plex Mono 400/500, `"IBM Plex Mono", ui-monospace, monospace`. Round labels, timers, scores, points columns, Stats for geeks, small caps-style eyebrow labels (13px, uppercase, `letter-spacing: 0.08em`).

Sizes in the mocks at desktop: hero h1 88px; screen prompt 40px; card titles 28 to 34px; question titles 22px; body 16 to 21px; eyebrow labels 13px. Scale the large ones down with `clamp()` on phones (hero to about 48px, prompt to about 28px).

## Layout

- `main` max-width goes from 760px to 1120px, side padding 24px (16px on phones). Vertical rhythm: 32 to 48px between screen sections, 16 to 24px inside cards.
- Header bar on every screen: "BRASS ANCHORS" wordmark (Oswald 600, 15px, tracking 0.12em) left; on round screens, the round progress segments centre and the running score right; on the front page, the "On air" dot right; on the end screen, a grey dot with "Off air". A 1px `--line` rule below.
- Radii are small: 4px cards, 3px buttons and wells. Nothing is pill-shaped except the round play button in the classic player.
- Everything wraps to one column under about 600px (the mocks use `flex-wrap` with `flex-basis` 360 to 460px; the existing grid-based `.modes` and `.cards` can keep their grid and media query).

## Components

- **Primary button** (`button.primary`): brass fill, `--accent-ink` text, Oswald 600 uppercase, min-height 48px (52px for Next, Reveal, Finish). Hover: lighten brass slightly (`#D9B23A`). Disabled: 45% opacity, as now.
- **Secondary button**: transparent, 2px `--line-strong` border, `--fg` text, same type. A brass-bordered variant marks the main choice on a card ("This one", the classic mode's Play, New game).
- **Answer options** (classic questions): Oswald 18px, min-height 48px, 1px `--line-strong` border; chosen = brass fill and `--accent-ink` text (replaces today's outline-only `.chosen`).
- **Segmented control** (the Sound switch, `.timbre-switch`): one bordered strip, buttons divided by 1px lines, 44px tall; the active one is `--fg` fill with `--accent-ink` text and `aria-pressed="true"`.
- **Lower-third caption**: a solid brass tag (Oswald 700, uppercase) butted against a `--fg` bar with `--accent-ink` text. Used for the match prompt ("FIND" + the description) and the classic reveal (points tag + speaker name and programme). Wraps to two lines on phones; the tag stays at the start.
- **Round progress**: five 40×6px segments in the header (done = brass, current = `--fg`, to come = `--line`), with `aria-label="Round 3 of 5"`. With more than about 12 rounds, fall back to text ("Round 13 of 20").
- **Player**: the progress bar is 4px, `--line` track and brass fill. The playing card gets an inset 2px brass outline and a brass "● Playing · 0:07" status; a finished clip shows "Played · 0:14" in `--muted`. The play button's text still toggles as `shared.js` does now (Play/Stop); the mocks' icons are optional.
- **Tables** (reveal, summary): rows separated by `--line`; row labels in Oswald uppercase; values in Source Sans; points column right-aligned in Plex Mono with tabular numbers. Header cells are eyebrow labels.
- **Inputs**: checkbox and radio use `accent-color: var(--accent)`; the rounds number input and the textarea sit on `--card` or `--well` with a `--line-strong` border.

## Spectrogram

Keep the existing magma palette in `web/spectrogram-math.js` (it is tested, perceptually ordered, and its black-to-pale-yellow range sits well next to brass). The mocks draw a clean brass pitch line only as a stand-in; do not replace the heatmap with a line. Changes are frame only: the `.spectro` box sits in a `--well`-coloured frame with 12px padding and a 3px radius; the frequency tick labels stay as they are. A thin `--fg` playhead line is a nice-to-have if it is cheap in `visualizer.js`; skip it otherwise.

## Screens

Match each to its mock. Keep every element id that the JS uses (`start-match`, `start`, `pure`, `rounds`, `chair-country`, `clip-count`, `collect-note`, `play`, `progress-bar`, `spectrogram`, `questions`, `bonus`, `reveal`, `reveal-table`, `reveal-thumb`, `reveal-who`, `play-original`, `youtube-link`, `next`, `match-*`, `final-score`, `summary-table`, `cues`, `save`, `export`, `again`, `save-status`, `load-error`), and keep the existing copy except where this file says otherwise.

1. **Front page** (`front-page.html`). Eyebrow "Tonight's broadcast"; hero h1 "The news, played on a trombone." (two lines); then the existing tagline. Two mode cards with a coloured header strip: Match the description gets a brass strip "Recommended · 5 rounds" and a primary Play (it keeps `autofocus`); Guess the clip gets a `#24344F` strip "Classic", its three variant radios (the same-chair country `<select>` stays inline with the third), and a brass-bordered secondary Play. Options row below a rule: Pure mode checkbox, Rounds input, and the clip-count line pushed right in Plex Mono. The anonymous-data note (`collect-note`, shown only when collecting) sits under that row in `--muted` body text at 15px; it is not in the mock.
2. **Match round** (`match-round.html`). Eyebrow "Round 3 of 5 · Medium", the lower-third prompt, two clip cards (letter in Oswald 28px, status top right, spectrogram well, progress, a Play/Replay button and a full-width "This one" button), then the Sound switch left and "Play both clips, then pick one." right. Pick buttons stay disabled until both clips have been started, as now.
3. **Match reveal** (`match-reveal.html`). Eyebrow with level plus a result tag ("Right, +2" on `--good-solid`; "Not this time" on `--bad` with `--accent-ink` text), the same lower-third prompt, then the two reveal cards: head row (letter, "Matches" / "Doesn't match", a brass "Your pick" chip pushed right), thumbnail (72px square crop, or the existing 96×64 if that is simpler) with speaker and programme (station), the Country/Year/News-or-opinion table with differing values in `--bad` and a ✕, **Stats for geeks always open on both cards**, the original's spectrogram, Hear the original, and Source on YouTube. Keep the subgrid so every section lines up across A and B: comparing the two stats tables side by side is the point of the section. Next/Finish bottom right.
4. **Classic round** (`classic-round.html`). One wide player card: round label and the Sound switch on top, a taller spectrogram (160px), then a round 56px brass play button, the progress bar, and a Plex Mono timer. Questions below in a two-column wrap, each a `<fieldset>` with an Oswald title and the points in a muted Plex note ("2 pts, 1 if a decade off", "1 pt"). The station bonus has a dashed `--line-strong` border and a brass title. Country shows only the countries in the corpus (two buttons, US and UK, in v1); the mock's [Country] placeholders are not real options. Bottom row: a muted hint left, Reveal right.
5. **Classic reveal** (`classic-reveal.html`). Eyebrow "Round 2 of 5 · The answer"; a lower-third with the round's points in the brass tag and the thumbnail, speaker, and "programme (station, year)" in the light bar; "N of M possible" to the right. The guess/answer/points table: correct guesses in `--good` with ✓, one-off decades in brass with a muted "one off", misses in `--bad`, unanswered as a muted em dash. Then a card "Now hear the real voice" with the original's spectrogram, Hear the original, and the YouTube link. Next/Finish bottom right.
6. **End** (`end.html`). Header with the "Off air" dot. Left: eyebrow "And that's the way it was", the final score as a big Oswald number with the maximum in muted (`7 / 9`), and the mode and round count. Right: the existing summary table (the score string `showEnd` already passes, e.g. `7 / 9`, split so the maximum can be muted) (accuracy by level, hard rounds, the fallback note) styled as above. Below, a card with "What gave it away?" (label for `cues`), the textarea, Save (primary), Export all saved games (JSON), New game (brass-bordered), and the save status in muted text.

## New on screen

The rest is styling. These need small JS changes; each reads data the game already has.

- Running score in the header of round and reveal screens.
- Round progress segments (above).
- The match reveal's result tag ("Right, +2") replaces today's coloured inline text; same values.
- Points notes on the classic question titles, from `POINTS` in `quiz-core.js` (and the one-off rule for decade).
- The classic reveal's "N of M possible", from `maxScorePerRound`.

Leave out anything in the mocks that the game cannot supply; the [bracketed] values are placeholders for real data.

## Constraints

- Do not change game rules, scoring, logging, or the saved-game format. `make test` must still pass; add or update tests only for the new display helpers if they are pure functions (put them in the `*-core.js` modules, as the codebase does).
- No new dependencies or build step; plain CSS in `web/style.css`.
- Touch targets at least 44px. Keyboard focus visible on every control (a 2px brass `outline` with 2px offset on `:focus-visible`). Colour is never the only signal: keep ✓/✕/"one off" text alongside the colours.
- The review page (`web/review.html`, `review.css`) is out of scope; leave its look alone unless asked.

## Verification

Run `make test`, then `make serve` and play one game of each mode at desktop width and at 390px wide. Check: header progress and score update per round; pick buttons unlock once both clips have started; both Stats for geeks tables line up row for row on the match reveal; the spectrogram still draws in step with playback; no horizontal scroll on the phone width; the console is clean. Then record the change under "Decisions" in `PROJECT.md`.
