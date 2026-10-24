# Administrator ranking audio and examples release

Target: user-authorized production change; no lab services used.
Worktree: `.tmp/ranking-examples-release-20261025`, branch `codex/ranking-examples-release-20261025`.
Observed production baseline: `70537d24601d9ef462a2ae8cd3c52bca8dcdeb17`,
Vercel `dpl_7oYkEAsnHMtr81HAunnwP4ixujf8`, verified against the actual www.easycut.co.kr alias and raw deployment metadata.
Production project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`.
AWS STS account `181651591905`; isolated ranking ECS service `shorts-ranking-production` is desired/running/pending 0 before changes.
Existing task revision 5: source `0c950c50971f6533e1c053a5cc0442b094600565`, digest `sha256:7160ffe70544d76db4b95e1e481659a54dbdbe09332d7f105dc5d51790cc4d4c`.
Supabase project `mvcprswvfybudtopepuj`, PostgreSQL 17.6, database postgres, existing shorts_mvp ranking tables confirmed. No pending/running ranking operations at inspection.

## Scope

- Optional single transition effect and optional uploaded background music; fixed top-three colors and inactive opacity from the local tested commits. Normalize full-range social video to limited range before concatenation so black transitions remain true black. Ignore expected browser music play cancellation.
- Examples button opens a responsive gallery without navigating away from the editor. Desktop four-column thumbnail cards; mobile two-column bottom sheet. Search by title/channel/category, custom category/sort selects, click-to-play YouTube embed, original link fallback.
- Import 100 unique YouTube Shorts from the user-supplied 랭킹쇼츠_100개.xlsx, sheet 영상 100개 rows 7–106. Store immutable snapshot date 2026-10-24 and do not present these counts as live or as an official platform ranking.
- Catalog is server-only and returned by a private/no-store API after requireRankingAdmin. No catalog/download requests before opening, one embed only after selection, lazy thumbnails. Editor state remains mounted.
- Existing administrator page/API/sidebar gates, publishing maintenance, ordinary worker/upload targets and database schema remain unchanged.

## Verification / release plan

- Admin-only catalog API tests cover disabled feature, guest, non-admin and admin; imported IDs/links/count validated against XLSX. Local browser search and actual embed playback verified.
- Full repository make verify, production route manifest comparison, exact unaliased production candidate protected-path checks, admin browser example access and bounded real audio render before promotion.
- Worker rollout first, using exact pinned image and source. Compare isolated stack diff; no ordinary worker changes. Preserve revision 5 and previous outputs, never interrupt active jobs, restore idle desired count 0 after tests.
- Bounded test estimate: one ranking task, up to 2 short render jobs, up to 60 minutes active, existing resources only. Routine metered test cost authorized; no new recurring resource.
- Cloud candidate and actual email delivery evidence will be recorded in the final release verification artifact. Local results alone do not prove cloud delivery.
