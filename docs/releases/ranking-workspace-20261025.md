# Ranking workspace and Korean examples

Target: authorized production change. Isolated worktree `.tmp/ranking-workspace-20261025`, branch `codex/ranking-workspace-20261025`, based on promoted production commit `b9105b03300291a11c35c40cd8705907b51a4d69`. Actual www alias remains `dpl_A2V8mAnwJRmZ38Nn1ddYy6EYSEcX` at preflight.

Vercel project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`; production configuration pulled into ignored `.vercel`. AWS STS confirms `181651591905`. Actual ranking cluster/service `shorts-ranking-production` uses task definition revision 7, desired/running/pending 0/0/0. No worker, infrastructure, schema, publishing-maintenance or ordinary-user access changes. No lab configuration used.

## Behavior

- Inspiration button beside the heading; prominent reset action with confirmation.
- Account-scoped browser draft metadata and IndexedDB file persistence. Reload restores title, ranks, order, cuts, design and audio. Browser storage is local to this browser; quota errors are visible. Local supported media previews before upload; files upload when submitting. Successful submission clears the draft. Explicit reset preserves completed projects.
- Ranking-only project cards below the editor reuse existing polling, thumbnail and deletion behavior. Submission stays on the page, scrolls to inline preparation/progress, and opens completed results in a dialog.
- Import user's `한국어_랭킹쇼츠_100개.xlsx`, sheet `영상 100개`, 100 data rows after row 6. Fourteen IDs overlap the original catalog, yielding 186 unique examples with 100 Korean entries. Duplicate metadata uses the newer 2026-10-25 snapshot; other entries retain 2026-10-24 dates. Korean locale prioritizes Korean entries; default descending view order within language groups. Other locales sort all entries by views. Catalog remains behind administrator-only API.

## Verification

- Web suite: 490 passed files / 3,875 passed tests, 13 files / 170 tests skipped by their existing configuration.
- TypeScript, ESLint, worker/infrastructure Python lint, and Next production build pass. Existing optional linkedom/canvas build warning remains.
- Browser local fixture: actual MP4 file and 0.1–7.9 second selection survive reload; title and rank label restore; reset cancel preserves input; confirmed reset remains cleared after reload. Mock submission contains the exact selection and uploaded ID and shows the inline running card. This mock does not prove AWS execution.
- Browser verifies Korean-first descending view gallery and 390px mobile heading/reset layout. Dedicated tests cover locale ordering, immutable input, latest-order selection, unique catalog and authorization denial.
- Before promotion: clean committed source, route manifest comparison, exact unaliased candidate protected-path checks and authenticated submission against existing production service. One bounded synthetic short render, existing resources, restore idle capacity after verification. Ordinary test cost already authorized.
