PY := .venv/bin/python

.PHONY: audio fetch normalize contours synth encode portraits thumbs manifest serve review check-pairs test site site-dev deploy db-setup stats feedback

# Full pipeline; every stage skips work that's already done, so reruns are cheap.
audio: fetch normalize contours synth encode portraits thumbs manifest

fetch:
	$(PY) -m pipeline.fetch
normalize:
	$(PY) -m pipeline.trim_normalize
contours:
	$(PY) -m pipeline.extract_contour
synth:
	$(PY) -m pipeline.synth
encode:
	$(PY) -m pipeline.encode
# Speaker pictures picked from the clip's video, for speakers without a screenshot in thumbnails/
portraits:
	$(PY) -m pipeline.portraits

thumbs:
	$(PY) -m pipeline.thumbnails
manifest:
	$(PY) -m pipeline.build_manifest
	ln -sfn ../processed web/audio

PORT ?= 8000

# make serve            -> front page with the mode selector
# make serve MODE=match -> prints a link that starts "Match the description" directly
# make serve PORT=8001  -> another port, if 8000 is taken
serve:
ifneq ($(MODE),)
	@case "$(MODE)" in classic|match|language) ;; *) echo "MODE must be classic, match, or language" >&2; exit 2;; esac
	@echo "Open http://localhost:$(PORT)/?mode=$(MODE)"
endif
	$(PY) -m pipeline.static_server -p $(PORT)

# Coverage of easy/medium/hard pairs for "Match the description"
check-pairs:
	node tools/check-pairs.mjs

# Review page at http://localhost:8001/review.html; edits clips.csv and rebuilds clips
review:
	$(PY) -m pipeline.review_server

test:
	$(PY) -m pytest -q
	node --test web/ server/

# ---------- Deploying (Cloudflare Pages + D1; first-time set-up in README.md) ----------
WRANGLER := npx wrangler
DB := brass-anchors

# dist/: the game plus only the media quiz.json plays (run `make audio` first)
site:
	$(PY) -m pipeline.build_site

# The deployed site on this machine, with a local database: http://localhost:8788/?collect=1
site-dev: site
	$(WRANGLER) d1 execute $(DB) --local --file server/schema.sql
	$(WRANGLER) pages dev --port 8788

# Create the events table in the live database (safe to rerun)
db-setup:
	$(WRANGLER) d1 execute $(DB) --remote --file server/schema.sql

deploy: site
	@if grep -q '00000000-0000-0000-0000-000000000000' wrangler.toml; then \
	  echo "Set database_id in wrangler.toml first (see README.md, Deploying)." >&2; exit 2; fi
	$(WRANGLER) pages deploy dist --branch main --commit-dirty=true

# Accuracy, answer times, and notes from the live database, counting each player's first game
# only (later games replay familiar clips); ALL=1 includes replays, LOCAL=1 reads the site-dev database
stats:
	@$(WRANGLER) d1 execute $(DB) $(if $(LOCAL),--local,--remote) --json --command "SELECT * FROM events" | node tools/stats.mjs $(if $(ALL),--all,)

# Messages from the site's feedback form; LOCAL=1 reads the site-dev database
feedback:
	@$(WRANGLER) d1 execute $(DB) $(if $(LOCAL),--local,--remote) --json --command "SELECT received_at, page, message FROM feedback" | node tools/feedback.mjs
