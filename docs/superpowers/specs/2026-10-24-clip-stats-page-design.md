# Clip stats page: design

Date: 2026-10-24. Status: reviewed; awaiting the owner's approval.

## Intent

A page for someone curious about languages, not a researcher, who has played the game or is about to. It should be informative and entertaining. It answers three questions:

1. Which clips fool people, and which languages get mistaken for one another?
2. What is measurably different between groups of voices: languages, decades, women and men?
3. Who are the standout individuals?

The owner's own observations are the kind of thing the page should let a reader check: Russian anchors pause longer between sentences, French anchors run on in one continuous sentence, Mandarin has a very wide pitch range, and some individual English speakers have a wide range too. The real data already shows these. Russian anchors pause 17 times a minute (French 13.5), with longer pauses (0.39 s against 0.34 s). French has the narrowest median pitch range (10.2 semitones) and Mandarin the widest (16.9). Andy Rooney (19.2 st) rivals the top Mandarin anchors.

## Goals

- One new page, linked from the bottom of the front page (beside "Everyone's results so far") and from the results page (`stats.html`).
- Four sections, in this order:
  1. **Hardest to get right**: clips ranked by how often players miss them, then which languages get mistaken for which.
  2. **At a glance**: a table of group medians.
  3. **Standouts**: named record-holders.
  4. **Every clip**: one dot chart per measurement.
- A switch for sections 2 and 4 that regroups the rows by **language**, **decade**, or **women / men**.
- Works on phones, in the game's look (`web/style.css`), in light and dark mode.

## Non-goals

- No audio on this page. Hovering (or tapping) a dot shows the speaker's name, nothing more. The owner decided this.
- No speaking rate. It's calibrated on English only (r = 0.57 against transcripts), and the game already hides it for other languages.
- No new measurements; the page uses the stats the pipeline already computes.
- No statistical tests or claims of significance.

## Anti-goals

- Comparing languages on average pitch with women and men mixed together. Pitch differs far more by sex than by language, so a mixed average would mislead. The owner decided: **pitch is always split by sex**.
- Looking more certain than the data is. With about ten clips per group and one speaker per clip, numbers are hints. The page says so in one plain sentence, as the README does.
- Ranking clips on too few plays.

## Data

### Clip measurements (static)

From `web/quiz.json`, each clip's `stats`:

| Field | Shown as |
|---|---|
| `median_hz` | Average pitch (Hz), split by sex |
| `range_st` | Pitch range (semitones) |
| `sd_st` | Pitch variation (semitones), chart only |
| `pauses_per_min` | Pauses per minute |
| `mean_pause_s` | Average pause (s) |
| `pause_pct` | Time silent (% of the clip) |

The manifest has no speaker sex. **Add `sex` (`m` / `f`) to each clip in `web/quiz.json`**, from the `sex` column of `clips.csv` (`pipeline/build_manifest.py`). The group for "language" is the language, with English split into **English US** and **English UK** (country), since the two Englishes are a comparison the game is built on. "Decade" groups all languages together by `answer.decade`.

### Play results (live)

From the D1 `events` table, like the results page. The owner decided: **count every game, including replays**, so the section fills quickly. (The results page counts each player's first game only; this page deliberately differs, and says so in a short note.) `summarize(rows, { firstGamesOnly: false })` in `server/stats-core.js` already supports this.

- **Per-clip miss rate, one ranked list per game.** The owner decided: **a separate hardest list for each game**, not one pooled list. Pooled, the list would be all English clips from Guess the clip: that game uses English clips only and asks up to four questions, so it misses far more often than Guess the language, and no French, Russian, or Mandarin clip would ever appear.
  - Guess the language: the round's clip, missed if the language guess is wrong.
  - Guess the clip: the round's clip, missed if any question the round asked scored zero (the bonus doesn't count). A decade one off earns a point, so it isn't a miss. The one-country variant doesn't ask country, so only the questions actually asked count. (My call.)
  - Match the clue: the clip that was the right answer, missed if the player picked the other one. Games from before the scoring change count too; whether the pick was right is recorded the same way. (My call.)
  - Rank by miss rate; show the play count beside each; leave out clips with fewer than 3 plays (the results page's `minAttempts`). Show up to 10 per game.
  - Rounds play only the trombone or the hum (the original voice comes after the answer), so every round is a melody round, and both sounds count together.
- **Languages mistaken for which**: from Guess the language rounds, every game counted. The results page already has `mistakenFor`.

A new endpoint, `GET /api/clip-stats` (a Pages function beside `functions/api/stats.js`), returns these, computed in a tested pure module in `server/`. Same caching header as `/api/stats` (60 s).

## Page

A new `web/clips.html` (name is the builder's call), styled with `web/style.css`, with the same top bar as the results page. Rules live in a pure `*-core.js` module with tests beside it; the DOM module stays thin, as elsewhere in `web/`.

1. **Hardest to get right.** Three tabs, one per game (Guess the language, Match the clue, Guess the clip), as on the results page. Each tab lists that game's hardest clips: thumbnail, speaker, programme and year, language, miss rate as "missed 7 of 9". Under the Guess the language tab, a small "mistaken for" table: rows are the true language, columns what players said. English is one row and one column there, because a guess records only the language, so US and UK can't be told apart. Until a game has a clip with 3 plays, its tab says so in one line, rather than showing an empty table.
2. **At a glance.** Table rows are the groups. Columns: pitch (women), pitch (men), pitch range, pauses per minute, average pause, time silent. Values are medians. With the women / men switch, the rows are Women and Men, and the two pitch columns become one.
3. **Standouts.** Named extremes over all 50 clips: widest and narrowest pitch range, most and fewest pauses per minute, longest share of silence, longest average pause. Each line: label, speaker, group and year, value.
4. **Every clip.** One horizontal dot chart per measurement: pitch (women), pitch (men), pitch range, pitch variation, pauses per minute, average pause, time silent. One row per group; one dot per clip (filled for women, hollow for men); a bar at the group median, with the median value at the row's right end. The single most extreme clip gets its name printed beside its dot. Each chart has a one-line plain-language caption, written from the data when the page is built or by hand (builder's call). Axes are fitted to the data with some margin, so no dot touches a label. Inline SVG, no chart library.

The switch (language · decade · women / men) is one control that drives sections 2 and 4 together, and remembers the choice in the URL (`?by=decade`). Under women / men, the two pitch charts become one, as the table's two pitch columns do. A group with no women or no men (the 1960s has no women) shows a blank pitch cell and an empty chart row, not a zero.

A one-line note near the top: what the measurements are (link to the README's "What the game tests"), and that groups are small, one speaker per clip, so differences are hints. Group sizes vary (about ten per language; the 1960s and 1970s have only three or four clips), so each table row shows its clip count.

Mockups made during design: `.superpowers/brainstorm/` (git-ignored); the agreed layout is "A and B combined" with Standouts moved above the charts.

## Constraints

- Static site plus Pages functions, no build step, vanilla ES modules (as `web/` today).
- Red/green TDD for the pure modules (server summary, page rules), per the owner's CLAUDE.md.
- No new personal data. The endpoint returns aggregates only, as `/api/stats` does.
- Rejected clips are already absent from `quiz.json`; the page uses whatever the manifest holds.
- Deploys only when the owner says so.

## Left to the builder

- File and endpoint names, and the link text ("Clip stats" or similar).
- Chart captions: computed or hand-written.
- Exact standouts list beyond the ones above.
- Phone layout details (the charts must stay readable at 360-390 px wide; the table may scroll sideways inside its card if needed).
