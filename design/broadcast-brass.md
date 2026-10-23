# Visual design: Broadcast brass

Instructions for restyling the game (`web/index.html`, `web/style.css`, and the markup the screen modules build) in the look Gregory chose on 2026-10-23. The game's behaviour, rules, and tests stay as they are; this is a skin plus a few small display additions, listed under "New on screen" below.

Reference mocks, one per screen, are in `design/broadcast-brass/` (open them in a browser; they are static HTML with inline styles and placeholder data in [brackets]). The mocks are the source of truth for layout and spacing; this file is the source of truth for tokens and rules. The editable canvas is https://claude.ai/artifact/AuV8Z6CTz8KgTBhfTbuLu5 (private to Gregory).

## The idea

A 1970s network newsroom at night: deep navy, brass accents, tall condensed capitals, and on-screen captions in the style of a TV lower third (a solid tag plus a contrasting caption bar). A daytime version of the same palette serves players whose system is set to light. It plays on the name and on the game's subject, decades of broadcast news. Keep it restrained: one accent colour, no gradients, no glow, no textures.

## Tokens

Replace the `:root` variables in `web/style.css`. Dark ("night broadcast") is the default and the identity; a light ("daytime") scheme follows the player's system setting through `@media (prefers-color-scheme: light)`, the same mechanism `style.css` uses today (inverted: today light is the default and dark the override). No toggle in the UI. Write every colour in the CSS as a token so the override block is the only place the light values live; the hex values in the mocks map onto these tokens.

| Token | Dark (default) | Light | Use |
|---|---|---|---|
| `--bg` | `#0E1726` | `#F2F4F7` | page |
| `--card` | `#16233A` | `#FFFFFF` | cards, panels |
| `--inset` | `#0A111D` | `#EEF1F5` | Stats for geeks panel and other insets inside cards |
| `--well` | `#0A111D` | `#0E1726` | spectrogram frame: dark in both schemes (see Spectrogram) |
| `--strip` | `#24344F` | `#DDE3EC` | the "Classic" mode-card header strip |
| `--line` | `#2A3A56` | `#D5DBE5` | rules, empty progress, inactive round segments |
| `--line-strong` | `#3A4C6B` | `#7D8AA0` | outlines of secondary buttons, answer options, inputs, segmented controls |
| `--fg` | `#F2EBDD` | `#0E1726` | text; the current round segment; the active segment fill |
| `--on-fg` | `#0E1726` | `#FFFFFF` | text on an `--fg` fill (active Sound button) |
| `--fg-soft` | `#C9D1DE` | `#2E3B52` | body copy on cards |
| `--muted` | `#A9B3C4` | `#56627A` | labels, meta text, timers |
| `--accent` | `#C9A227` | `#C9A227` | brass as a fill or outline: primary buttons, chosen answers, tags, progress fill, playing outline |
| `--accent-hover` | `#D9B23A` | `#B8931C` | primary button hover |
| `--accent-text` | `#C9A227` | `#7F6209` | brass as text or a thin line: eyebrows, "Playing" status, station-bonus title, one-off decade, focus ring |
| `--accent-ink` | `#0E1726` | `#0E1726` | text on brass |
| `--caption-bg` | `#F2EBDD` | `#0E1726` | the bar of the lower-third caption |
| `--caption-fg` | `#0E1726` | `#F2EBDD` | text in that bar |
| `--caption-meta` | `#3A4C6B` | `#A9B3C4` | the programme line in the classic reveal's caption |
| `--good` | `#6FCF97` | `#1E7A4A` | "Matches", correct guesses (text) |
| `--good-solid` | `#3E9C6B` | `#3E9C6B` | the "Right, +N" tag (with `--accent-ink` text) and the matching card's outline |
| `--bad` | `#F08A74` | `#B4432C` | "Doesn't match", wrong values, errors (text) |
| `--bad-solid` | `#F08A74` | `#B4432C` | the "Not this time" tag |
| `--on-bad` | `#0E1726` | `#FFFFFF` | text on that tag |
| `--live` | `#E2533A` | `#E2533A` | the small "On air" dot only |

Rules that keep both schemes legible:

- Brass (`#C9A227`) is 2.4:1 on white, so in light mode it is only ever a fill with `--accent-ink` text (7.4:1) or a thick border. Anything that reads brass as text or a thin line uses `--accent-text` (at least 5:1 on `--bg`, `--card`, and `--inset`). In dark mode the two are the same colour.
- All text tokens pass 4.5:1 on their `--bg` and `--card`; `--line-strong` passes 3:1 for control borders. Never put `--muted` on brass.
- The lower-third caption inverts in light mode (navy bar, light text) so it still reads as a broadcast caption against a pale page; the brass tag beside it stays the same.
- The page `body` sets `color-scheme: dark light` in the default and `color-scheme: light` in the override, so native controls (scrollbars, the number input, the select) follow.
- `--part` is retired: the one-off decade uses `--accent-text` plus the "one off" note.

The mocks show only the dark scheme. Check light mode by switching the system appearance (or Chrome DevTools > Rendering > Emulate prefers-color-scheme).

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

- **Primary button** (`button.primary`): brass fill, `--accent-ink` text, Oswald 600 uppercase, min-height 48px (52px for Next, Reveal, Finish). Hover: `--accent-hover`. Disabled: 45% opacity, as now.
- **Secondary button**: transparent, 2px `--line-strong` border, `--fg` text, same type. A brass-bordered variant (2px `--accent`) marks the main choice on a card ("This one", the classic mode's Play, New game).
- **Answer options** (classic questions): Oswald 18px, min-height 48px, 1px `--line-strong` border; chosen = brass fill and `--accent-ink` text (replaces today's outline-only `.chosen`).
- **Segmented control** (the Sound switch, `.timbre-switch`): one bordered strip, buttons divided by 1px lines, 44px tall; the active one is `--fg` fill with `--on-fg` text and `aria-pressed="true"`.
- **Lower-third caption**: a solid brass tag (Oswald 700, uppercase) butted against a `--caption-bg` bar with `--caption-fg` text. Used for the match prompt ("FIND" + the description) and the classic reveal (points tag + speaker name and programme). Wraps to two lines on phones; the tag stays at the start.
- **Round progress**: five 40×6px segments in the header (done = brass, current = `--fg`, to come = `--line`), with `aria-label="Round 3 of 5"`. With more than about 12 rounds, fall back to text ("Round 13 of 20").
- **Player**: the progress bar is 4px, `--line` track and brass fill. The playing card gets an inset 2px `--accent` outline and an `--accent-text` "● Playing · 0:07" status; a finished clip shows "Played · 0:14" in `--muted`. The play button's text still toggles as `shared.js` does now (Play/Stop); the mocks' icons are optional.
- **Tables** (reveal, summary): rows separated by `--line`; row labels in Oswald uppercase; values in Source Sans; points column right-aligned in Plex Mono with tabular numbers. Header cells are eyebrow labels.
- **Inputs**: checkbox and radio use `accent-color: var(--accent)`; the rounds number input and the textarea sit on `--card` or `--inset` with a `--line-strong` border.

## Spectrogram

Keep the existing magma palette in `web/spectrogram-math.js` (it is tested, perceptually ordered, and its black-to-pale-yellow range sits well next to brass). The mocks draw a clean brass pitch line only as a stand-in; do not replace the heatmap with a line. Changes are frame only: the `.spectro` box sits in a `--well`-coloured frame with 12px padding and a 3px radius; the frequency tick labels stay as they are. The well stays dark in light mode on purpose: magma starts at near-black, so silence must sit on dark, and a dark panel on a pale page reads as a monitor screen, which suits the idea. A thin light (`#F2EBDD`) playhead line is a nice-to-have if it is cheap in `visualizer.js`; skip it otherwise.

## Screens

Match each to its mock. Keep every element id that the JS uses (`start-match`, `start`, `pure`, `rounds`, `chair-country`, `clip-count`, `collect-note`, `play`, `progress-bar`, `spectrogram`, `questions`, `bonus`, `reveal`, `reveal-table`, `reveal-thumb`, `reveal-who`, `play-original`, `youtube-link`, `next`, `match-*`, `final-score`, `summary-table`, `cues`, `save`, `export`, `again`, `save-status`, `load-error`), and keep the existing copy except where this file says otherwise.

1. **Front page** (`front-page.html`). Eyebrow "Tonight's broadcast"; hero h1 "The news, played on a trombone." (two lines); then the existing tagline. Two mode cards with a coloured header strip: Match the description gets a brass strip "Recommended · 5 rounds" and a primary Play (it keeps `autofocus`); Guess the clip gets a `--strip` strip "Classic", its three variant radios (the same-chair country `<select>` stays inline with the third), and a brass-bordered secondary Play. Options row below a rule: Pure mode checkbox, Rounds input, and the clip-count line pushed right in Plex Mono. The anonymous-data note (`collect-note`, shown only when collecting) sits under that row in `--muted` body text at 15px; it is not in the mock.
2. **Match round** (`match-round.html`). Eyebrow "Round 3 of 5 · Medium", the lower-third prompt, two clip cards (letter in Oswald 28px, status top right, spectrogram well, progress, a Play/Replay button and a full-width "This one" button), then the Sound switch left and "Play both clips, then pick one." right. Pick buttons stay disabled until both clips have been started, as now.
3. **Match reveal** (`match-reveal.html`). Eyebrow with level plus a result tag ("Right, +2" on `--good-solid` with `--accent-ink` text; "Not this time" on `--bad-solid` with `--on-bad` text), the same lower-third prompt, then the two reveal cards: head row (letter, "Matches" / "Doesn't match", a brass "Your pick" chip pushed right), thumbnail (72px square crop, or the existing 96×64 if that is simpler) with speaker and programme (station), the Country/Year/News-or-opinion table with differing values in `--bad` and a ✕, **Stats for geeks always open on both cards**, the original's spectrogram, Hear the original, and Source on YouTube. Keep the subgrid so every section lines up across A and B: comparing the two stats tables side by side is the point of the section. Next/Finish bottom right.
4. **Classic round** (`classic-round.html`). One wide player card: round label and the Sound switch on top, a taller spectrogram (160px), then a round 56px brass play button, the progress bar, and a Plex Mono timer. Questions below in a two-column wrap, each a `<fieldset>` with an Oswald title and the points in a muted Plex note ("2 pts, 1 if a decade off", "1 pt"). The station bonus has a dashed `--line-strong` border and an `--accent-text` title. Country shows only the countries in the corpus (two buttons, US and UK, in v1); the mock's [Country] placeholders are not real options. Bottom row: a muted hint left, Reveal right.
5. **Classic reveal** (`classic-reveal.html`). Eyebrow "Round 2 of 5 · The answer"; a lower-third with the round's points in the brass tag and the thumbnail, speaker, and "programme (station, year)" in the light bar; "N of M possible" to the right. The guess/answer/points table: correct guesses in `--good` with ✓, one-off decades in `--accent-text` with a muted "one off", misses in `--bad`, unanswered as a muted em dash. Then a card "Now hear the real voice" with the original's spectrogram, Hear the original, and the YouTube link. Next/Finish bottom right.
6. **End** (`end.html`). Header with the "Off air" dot. Left: eyebrow "And that's the way it was", the final score as a big Oswald number with the maximum in muted (`7 / 9`), and the mode and round count. Right: the existing summary table (accuracy by level, hard rounds, the fallback note) styled as above. The big number is the score string `showEnd` already passes (e.g. `7 / 9`), split so the maximum can be muted. Below, a card with "What gave it away?" (label for `cues`), the textarea, Save (primary), Export all saved games (JSON), New game (brass-bordered), and the save status in muted text.

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
- Touch targets at least 44px. Keyboard focus visible on every control (a 2px `--accent-text` `outline` with 2px offset on `:focus-visible`). Colour is never the only signal: keep ✓/✕/"one off" text alongside the colours.
- The review page (`web/review.html`, `review.css`) is out of scope; leave its look alone unless asked.

## Verification

Run `make test`, then `make serve` and play one game of each mode at desktop width and at 390px wide, in both dark and light system appearance. Check: header progress and score update per round; pick buttons unlock once both clips have started; both Stats for geeks tables line up row for row on the match reveal; the spectrogram still draws in step with playback; in light mode no brass text or thin brass line appears on a pale background (only fills, thick borders, and `--accent-text`); no horizontal scroll on the phone width; the console is clean. Then record the change under "Decisions" in `PROJECT.md`.
