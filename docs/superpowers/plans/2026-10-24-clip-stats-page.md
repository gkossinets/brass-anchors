# Clip Stats Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new page that compares the clips' speech measurements by language, decade, and sex, names the standouts, and lists each game's hardest clips.

**Architecture:** Clip measurements are static (`web/quiz.json`, which gains each clip's `sex`); the page groups and charts them in the browser with rules in a tested pure module. Play results come from a new Pages function, `/api/clip-stats`, whose aggregation is a tested pure module in `server/` reusing the round de-duplication of `server/stats-core.js`.

**Tech Stack:** Python 3.13 pipeline (pytest); vanilla ES modules, `node --test`; Cloudflare Pages Functions with D1; inline SVG, no chart library.

**Spec:** `docs/superpowers/specs/2026-10-24-clip-stats-page-design.md`

## Global Constraints

- Pitch is always split by sex; never a mixed-sex pitch average.
- Hardest clips: one list per game; every game counted, replays included (`firstGamesOnly: false`); only clips with at least 3 plays (`minAttempts = 3`); up to 10 per game.
- Miss rules: language, wrong language; classic, any asked main question (decade, country, genre) scored 0, bonus ignored; match, a miss for `correct_id` when `right` is false.
- No speaking rate on the page.
- The endpoint returns aggregates only; cache header `public, max-age=60`, as `/api/stats`.
- Group switch values: `language` (English split into English US / English UK), `decade`, `sex`; kept in the URL as `?by=`.
- Hovering a dot shows the speaker's name only; no audio.
- Game look (`web/style.css`), phone widths 360-390 px readable, light and dark.
- Red/green TDD for pure modules. No deploy without the owner's word.

## Review Focus

1. A group with no women or no men (1960s has no women): blank pitch cell and empty chart row, never 0 or NaN. Test in Task 4.
2. A clip whose `stats` is null or missing a field: left out of that measurement, not plotted at 0. Test in Task 4.
3. A round whose clip id is no longer in `quiz.json` (clip rejected later): listed by id without crashing; the page skips the thumbnail. Test in Task 2 (endpoint passes it through) and handled in Task 5.
4. The endpoint failing or the database being empty: the hardest section says it can't load or has too few plays; the measurement sections still render. Handled in Task 5, checked in its browser step.
5. `?by=` with an unknown value: falls back to `language`. Test in Task 4.

---

### Task 1: Speaker sex in the manifest

**Files:**
- Modify: `pipeline/build_manifest.py` (`clip_entry`)
- Test: `tests/test_manifest.py`

**Interfaces:**
- Produces: each clip in `web/quiz.json` has `"sex": "m" | "f" | ""` (from `Clip.sex`).

- [ ] **Step 1: Write the failing test** `test_manifest_carries_the_speaker_sex`: build from `write_csv(tmp_path)` with all ids available; assert `m["clips"][0]["sex"] == <that row's sex in write_csv>`.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_manifest.py -q` and see it fail with KeyError `'sex'`.
- [ ] **Step 3: Add** `"sex": clip.sex` to `clip_entry`, after `"speaker"`.
- [ ] **Step 4: Run** the tests; pass. Then `make manifest` and confirm `python3 -c "import json;print({c['sex'] for c in json.load(open('web/quiz.json'))['clips']})"` prints `{'m', 'f'}`.
- [ ] **Step 5: Commit** `pipeline/build_manifest.py tests/test_manifest.py`.

### Task 2: Per-game hardest clips (server)

**Files:**
- Modify: `server/stats-core.js` (export the round de-duplication)
- Create: `server/clip-stats-core.js`, `server/clip-stats-core.test.js`

**Interfaces:**
- Produces in `server/stats-core.js`: `export function countedRounds(rows, { firstGamesOnly = true } = {}) -> Array<{mode, game, round, record}>`: parsed, counted, de-duplicated round events; `summarize` uses it internally (no behaviour change).
- Produces in `server/clip-stats-core.js`: `export function clipDifficulty(rows, { minAttempts = 3, top = 10 } = {}) -> { minAttempts, rounds: number, language: { hardest: Entry[], mistakenFor: {[lang]: {[lang]: number}} }, match: { hardest: Entry[] }, classic: { hardest: Entry[] } }` where `Entry = { clip: string, n: number, missed: number }`, sorted by `missed / n` descending, then `n` descending, then `clip` ascending.

- [ ] **Step 1: Write failing tests** in `server/clip-stats-core.test.js`, building rows the way `server/stats-core.test.js` does (`kind: "round"`, `payload: JSON.stringify(record)`):
  - `language misses: a wrong language guess`: three rounds of clip `fr_a` (guesses `fr`, `ru`, `ru`) → `language.hardest[0]` deep-equals `{ clip: "fr_a", n: 3, missed: 2 }`; `mistakenFor.fr.ru === 2`.
  - `classic misses: a question scored zero; a decade one off is not a miss; the bonus is ignored`: rounds of `us_a` with scores `{decade:1,country:1,genre:1}`, `{decade:2,country:0,genre:1}`, `{decade:2,country:1,genre:1, station:0}` → `{ clip: "us_a", n: 3, missed: 1 }`.
  - `classic one-country rounds ask no country`: guess without `country` and score `{decade:2, genre:1}` (no `country` key) is not a miss.
  - `match misses count against the right answer`: three rounds with `correct_id: "uk_b"`, `right` false, false, true → `{ clip: "uk_b", n: 3, missed: 2 }`; `distractor_id` clips get no entry.
  - `replays count`: two games by the same player, each with rounds of `fr_a` → `n` counts both games.
  - `a round sent twice counts once` (same `game` and `round`).
  - `fewer than minAttempts plays are left out; at most top entries`: clip with 2 plays absent; 12 eligible clips → 10 entries.
  - `unknown clip ids pass through` (an id not in any manifest is still listed).
- [ ] **Step 2: Run** `node --test server/` and see the new file fail (module not found).
- [ ] **Step 3: Implement** `countedRounds` by moving the parse / count / de-duplicate part of `summarize` into it (summarize then calls it); implement `clipDifficulty` on `countedRounds(rows, { firstGamesOnly: false })`, taking `mistakenFor` from `summarize(rows, { firstGamesOnly: false }).language.mistakenFor`. Language rounds: `record.clip_id`, `record.language`, `record.guess.language`. Classic: `record.clip_id`, questions `["decade", "country", "genre"]` where `record.guess[q] !== undefined`, miss if any `record.score[q] === 0`. Match: `record.correct_id`, miss if `record.right === false`.
- [ ] **Step 4: Run** `node --test server/`; all pass, including the existing `server/stats-core.test.js`.
- [ ] **Step 5: Commit**.

### Task 3: `/api/clip-stats` endpoint

**Files:**
- Create: `functions/api/clip-stats.js`

**Interfaces:**
- Consumes: `clipDifficulty` (Task 2).
- Produces: `GET /api/clip-stats` → JSON of `clipDifficulty(rows)`, header `Cache-Control: public, max-age=60`.

- [ ] **Step 1: Write** `onRequestGet({ env })` mirroring `functions/api/stats.js` (same SELECT, same header), returning `Response.json(clipDifficulty(results), …)`.
- [ ] **Step 2: Verify** with `make site-dev` (local D1): `curl -s localhost:8788/api/clip-stats` returns JSON with keys `minAttempts, rounds, language, match, classic`.
- [ ] **Step 3: Commit**.

### Task 4: Page rules (pure)

**Files:**
- Create: `web/clips-core.js`, `web/clips-core.test.js`

**Interfaces:**
- Produces:
  - `MEASURES`: ordered array of `{ key, label, unit, digits, sex? }` for: pitch (women) `median_hz` sex `f`, pitch (men) `median_hz` sex `m`, pitch range `range_st`, pitch variation `sd_st` (charts only), pauses per minute `pauses_per_min`, average pause `mean_pause_s`, time silent `pause_pct`. Table columns are these minus `sd_st`.
  - `parseBy(search: string) -> "language" | "decade" | "sex"` (unknown → `"language"`).
  - `groupOf(clip, by) -> string`: language → `English US` / `English UK` / `French` / `Russian` / `Mandarin`; decade → `answer.decade`; sex → `Women` / `Men`.
  - `groupOrder(clips, by) -> string[]`: language in the order above; decades ascending; `Women`, `Men`.
  - `groupRows(clips, by) -> Array<{ group, n, medians: {[measureId]: number | null} }>`: medians per measure, the pitch measures over that sex only; `null` where no clip qualifies. Under `by = "sex"` the two pitch measures collapse into one `pitch` measure.
  - `standouts(clips) -> Array<{ label, clip, value }>`: widest and narrowest pitch range, most and fewest pauses per minute, largest time silent, longest average pause.
  - `axis(values: number[]) -> { lo, hi, ticks: number[] }`: padded so no value sits on an end, three ticks, round numbers.
- [ ] **Step 1: Write failing tests** with a small fixture of 6 clips (two languages, both sexes, one clip with `stats: null`, one decade with no women): `parseBy` (`?by=decade`, `?by=bogus`, empty); `groupOf` for an English UK clip; `groupRows` median values, `n`, a `null` women's pitch for the no-women decade, the null-stats clip excluded from medians but counted in `n`; sex grouping collapses pitch; `standouts` picks the expected speakers; `axis([7.5, 20.1])` has `lo < 7.5`, `hi > 20.1`, 3 ticks.
- [ ] **Step 2: Run** `node --test web/clips-core.test.js`; fail (module not found).
- [ ] **Step 3: Implement** the module.
- [ ] **Step 4: Run** `node --test web/`; pass.
- [ ] **Step 5: Commit**.

### Task 5: The page and its links

**Files:**
- Create: `web/clips.html`, `web/clips.js`
- Modify: `web/style.css` (page section), `web/index.html` (footer link), `web/stats.html` (link), `README.md`, `PROJECT.md`

**Interfaces:**
- Consumes: `web/quiz.json` (Task 1), `/api/clip-stats` (Task 3), `web/clips-core.js` (Task 4), `clipLabel` and `pct` from `web/stats-view-core.js`.

- [ ] **Step 1: Load the `dataviz` skill** before writing chart code; follow its mark, colour, and legend rules within the game's tokens.
- [ ] **Step 2: Build `web/clips.html`** with the results page's top bar, sections in this order: a one-line note (small groups, one speaker per clip; link to the README's "What the game tests"); **Hardest to get right** (three tabs: Guess the language, Match the clue, Guess the clip; entries "missed 7 of 9" with thumbnail, speaker, programme and year; "mistaken for" table under the language tab; a one-line note that this counts every game, replays included); **At a glance** (table with the switch, clip count per row); **Standouts**; **Every clip** (one SVG dot chart per measure, filled dot for women, hollow for men, median bar and value at the row end, the most extreme clip named, `<title>` with the speaker's name on each dot). The switch drives the table and charts and updates `?by=` with `history.replaceState`.
- [ ] **Step 3: Links.** Front page footer: add "Clip stats" beside "Everyone's results so far" (adjust the footer's column class). Results page: a link to the clip stats page near "Play a game".
- [ ] **Step 4: Verify in the browser** (headless Chrome, as before) at 390 px and 1280 px, light and dark: all sections render; `?by=decade` and `?by=sex` regroup; 1960s women's pitch blank; no dot overlaps a row label; with `/api/clip-stats` unreachable (plain static server), the hardest section shows its fallback line and the rest renders. Run `make test`.
- [ ] **Step 5: Docs.** README: the page under Game modes / results; PROJECT.md: status and the decisions from the spec.
- [ ] **Step 6: Commit.**
