# Local updates preview — 2026-09-30

- Scope: local page/content only. No deployment, cloud configuration, DB writes, account connections or video jobs.
- Worktree: `/Users/gimdongmin/.codex/worktrees/updates-preview/shorts-clean`
- Branch: `codex/updates-preview-20260930`; baseline: `72203bc7` (local source, not verified as the promoted production commit).
- Preview: http://127.0.0.1:3210/updates
- Runtime: Next.js 15.5.20; no production environment file loaded; guest navigation. Existing dependency folders reused via local symlinks.
- Content: 28 grouped user-facing changes from July 25 to September 30. Each JSON record retains its source commit. Dates are code change dates, not verified rollout dates.
- Images: 19 unchanged JPEG browser captures of current easycut.co.kr screens, captured September 30. Displayed using CSS crops and numbered overlays. They are not historical screenshots. Production interactions were read-only navigation, local unsaved editor selections, and search/filter controls.
- The channel screen shows YouTube connect and other platforms as preparing. No connection or upload was performed.
- Some historical production flows cannot be demonstrated read-only: creation/range/language posts use the current creation entry screen; the July payment post uses current pricing, explicitly noting later payment changes.

## Verification

- TypeScript full web check passed after resolving dependencies from the existing recent checkout.
- ESLint passed for new updates components and changed header/translations.
- All 28 detail URLs returned HTTP 200 with matching titles.
- Browser verified listing, article navigation, image zoom/close, keyword filtering (SNS: 2 results), July filtering (4 results), desktop layout and 390px mobile listing/article without horizontal overflow.
- Capture metadata verified: JPEG, 1920 x 873 for all 19 images.
- This is not production release verification. No build or promotion performed. Before any future release, use the actual promoted production baseline and retain repository release gates; do not deploy this preview branch wholesale.
