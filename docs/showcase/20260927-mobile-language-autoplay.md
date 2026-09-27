# Mobile language selector and source autoplay — 2026-09-27

- Authorized production UI fix, based on promoted source `68a05611c74123ea7932517dbe8939de88e64b38`. Worktree `.tmp/showcase-geo-release-20260927`, branch `codex/showcase-geo-release-20260927`; intervening parent is release documentation only.
- Released source `d59f0ec7c27d41d5566be83e68212e150a31fa1e`; deployment `dpl_ARDyNpW7YuwbgX37VCqZMPysh7za`, https://shorts-nyb8pmhv5-artiroom.vercel.app.
- User selected bottom-left mobile language control. Removed header duplicate and mobile CSS that hid the existing floating control. Existing modal/editor exceptions preserved.
- Source preview uses the same visibility, document visibility, reduced-motion and expanded-player gating as the selected short, with muted inline playback. Side cards remain unloaded until selected.
- Scoped ESLint, 14 existing tests, local/remote production build, route parity and production release guard passed. Registered worker admission fingerprint unchanged; no jobs submitted.
- Candidate browser at 390x844: KO/EN/JA floating button x=12, bottom=832; menu selections worked; source and center video readyState=4, paused=false and currentTime advancing, side clips unloaded. Live KO mobile repeated position/playback checks; viewport reset afterward.
- Candidate/live checks: guest showroom order in all languages, five protected paths, locale redirects, media master exclusion, production target fingerprint. Baseline rechecked before promotion; promoted same candidate without rebuilding.
- Initial 5-minute deployment error query returned zero records. This is a bounded release check, not ongoing monitoring.
- Evidence: `/tmp/showcase-autoplay-20260927/`. One local build and one deployment on existing services; no infrastructure, schema or fixed-cost changes.
