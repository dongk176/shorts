# Template channel identity and editor geometry — 2026-10-24

User explicitly authorized fixing and deploying all three reported issues.
Production baseline verified via actual Vercel alias and deployment API:
`dpl_E7WLHAGf9ATKJbL8LUZ2ZvchGcHX`, source
`a6fed53f7c35c7f9c8190685f006cf6359ea63df`, project
`prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`.
Isolated worktree `/private/tmp/easycut-template-editor-fixes-20261024`, branch
`codex/template-editor-fixes-20261024`. Existing dirty checkout and lab untouched.

Production DB read-only evidence: project 27094, short
`bc98676f-af8b-4658-838b-f3ae5431d95a`, built-in pop, square source,
saved v5 video y=570, saved video offset y=66, caption legacy layout y=420.
Old browser preview = 486; renderer = 636. Fixed preview resolves the saved
built-in v5 geometry just as the renderer does. Existing offsets and project
snapshots are preserved. Registered initial editor release
`e63d07c2-8c37-48ef-ba3b-7e55aad646c6` references the revisioned AWS production
job `shorts-mvp-editor-release-ad83422e4a94-4vcpu:1` and image digest
`sha256:357afd6f412720043d128a3e00dfffa1507e9ff3f55e95e6cb692df0f1d9b037`.
The config/geometry functions are AST-identical between that source and the
web baseline's worker source. No worker, queue, release registration, account,
schema, environment or publishing-maintenance changes are required.

Templates now accept optional channel.displayName (up to the existing 50-character
channel limit). The template UI saves and previews this value. Admission extracts
it into existing job channel_name for both link and upload jobs, then removes the
web-only field from the immutable worker config, retaining strict compatibility
with existing workers. Empty and absent names preserve the prior source/default
name behavior. Existing templates are not silently assigned a guessed name.

Caption and legacy inline channel previews no longer constrain a label to a
percentage of its own intrinsic-width parent, which caused premature ellipsis.
This fixes the reported 9/10-character case without changing existing worker
text fitting or silently altering saved font size. Names beyond the rendered
layer's actual available width still obey the existing renderer width limits.

Verification: 275 focused API/layout tests passed. Final full web suite:
3,771 passed, 162 skipped, zero failures (474 passing files). The obsolete
source-string assertion was updated to the saved-layout resolver; new functional
layout and channel regressions also passed. Lint and TypeScript passed. Four synthetic renderer
checks, including FFmpeg playable MP4, passed. Desktop 1440x1000 and mobile
390x844 Chromium checks verified complete @ugc_korea_ label (99px text width,
99px available width, no ellipsis), template input, save payload and reopening,
with no page errors. Browser save uses an intercepted local API; actual API
handlers and job metadata are separately exercised by integration tests. No
customer project is rerendered or overwritten by this release.

Configuration: local checks use no live DB/cloud credentials; production candidate
uses the existing production account/DB and preserves current worker bindings.
Lab is independent and is not used as production verification. Bounded estimate:
one or two existing-service web builds and local synthetic video checks, under
USD 3 incremental; no new recurring resources. Candidate route manifest and
protected paths must match production before promoting the exact tested deployment.
