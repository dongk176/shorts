# Ranking editor UI release — 2026-10-26

## Target and baseline
Authorized production UI release. Baseline `114ceaa061333959f87bd521a69500bb899887de`,
confirmed from the currently promoted `www.easycut.co.kr` deployment
`dpl_Hm4XZEUYvtajvxcQkcCWqFuVrkVJ` / `shorts-injlf9t9o-artiroom.vercel.app`.
Isolated worktree `.tmp/ranking-ui-release-20261026`, branch
`codex/ranking-ui-release-20261026`. Local UI experiment source is the separate
`.tmp/ranking-editor-ui-20261025`; its development route and obsolete designs are
not deployed.

Candidate uses artiroom/shorts `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, existing
production Supabase `mvcprswvfybudtopepuj` / `shorts_mvp`, existing Vercel sandbox
backend and dependency snapshot `snap_oPJ18yU5RpDAiNHC4wJePDz3c1SQ`.
No schema migration, worker code change, AWS rollout, capacity increase or lab
changes. Administrator, owner and origin gates remain unchanged.

## Scope
New ranking editor controls, rank colors, desktop fixed centered preview,
mobile scene sheet, click/drop file source area, consistent dialog dismissal and
existing popular API/card reuse for choosing videos <=180 seconds. Duration is a
candidate filter, not evidence that a video is officially a YouTube Short.
The existing popular API authorization still applies. YouTube embeds remain the
range-selection source; render acquisition keeps the existing proxy/retry path.

## Verification
Script tests: 215 passed. Infrastructure tests: 39 passed.
Full frontend/worker checks, candidate build, authenticated browser flows and
route comparison are pending at this initial record. No production promotion
until those gates pass. Check real popular filters, example selection, file and
social range selection, saved drafts, preview/render, admin denial, existing
home/projects/editor paths, desktop and mobile layout. Temporary candidate
callback entries must be removed after verification.

Bounded actual test: up to four short sources and one short mixed-platform render
with effect/BGM, plus at most one retry for a transient failure. Estimate under
USD 5 on existing metered services. No new idle recurring commitment. Keep test
results and exact candidate deployment identity in the local release evidence.
