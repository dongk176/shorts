# Ranking portrait source/cover correction

Target: authorized production correction. Baseline production deployment
dpl_6UR82Y1VjLMYoceJmtzptgjjJ7Ku, source
79742255ae4923dbdf060ab4d4785ce4895ef87f. Separate worktree
.tmp/ranking-portrait-preview-20261026, branch codex/ranking-portrait-preview-20261026.
Vercel artiroom/shorts prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw; no account, schema,
environment, worker snapshot, downloader, renderer or permission changes.

Problem: fixed landscape source-player heights made vertical videos tiny. The
composition used a 480×360 YouTube hqdefault cover containing letterboxing,
so center-cover scaling did not correspond to native vertical source cropping.

Changes:
- YouTube source viewport is 9:16, centered, bounded by viewport height and width.
- Downloaded portrait source players keep their source aspect ratio and native
  controls. Known landscape source behavior remains unchanged.
- Composition alone prefers original-aspect public YouTube covers. Existing
  project-card cover selection stays unchanged. Bounded fallback chain handles
  unavailable variants and ytimg's valid 120×90 placeholder responses.
- Actual media keeps object-fit:cover, matching the unchanged renderer's central
  scale-to-cover/crop. Remote YouTube image is explicitly labeled as a cover,
  not the selected timestamp. Source playback and render remain separate.

Local evidence:
- Exact reported video w-g1AInuLe8 reproduced. Its oardefault is 1060×1886;
  another short 22jHRTWP_To provides 1080×1920. Legacy hqdefault is 480×360.
- In real Chrome DOM the source host and iframe both measured 303.078×538.797,
  exact 9:16; composition loaded the original-aspect cover. No horizontal overflow.
- A regular landscape video with a missing oardefault placeholder advanced to
  oar2 (1920×1080), confirming actual browser fallback rather than relying on 404.
- Local auth-free development harness is removed from the release. Tests used
  public covers and existing player code; local project APIs correctly denied
  the unauthenticated harness. Background Chrome YouTube iframe loading timed out
  during local visual checks; player API/seek behavior is unchanged by this fix.
- Focused cover/player/draft suite: 33 passed. Full frontend: 499 files /
  3,911 tests passed, 182 skipped. Lint and typecheck passed after removing the
  development harness and its generated type cache. Production build and
  protected-route comparison are required before promotion.

Release verification configuration: this is a client-only visual change on the
current production baseline. No new login callback is needed: local visual
checks validate the same source; unaliased candidate protected paths and served
assets are checked before promotion, then the existing authenticated production
session verifies the actual corrected screen. Candidate authenticated browser
visual testing is not claimed. Admin gates remain unchanged.
