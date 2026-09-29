# Mobile menu scrollbar and showcase label

User requested hidden mobile menu scrollbars and the exact showcase choices `댓글 템플릿`, `자막 강조`, `깔끔하게`. Existing production deployment authorization continues.

Verified production baseline: source `83b543dcf4fbcf1dfdfcdefc35a879175e5fb68f`, deployment `dpl_4txGgHWThPEK4hqKreNS3i9WLfv1`. Reuse attached isolated worktree `/Users/gimdongmin/.codex/worktrees/site-copy-localization/shorts-clean`, branch `codex/mobile-menu-copy-20260929`, directly from that source. The prior report-only commit stays on its original branch.

Target: existing production Vercel project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`, root `web`, Node 24; existing production Supabase `mvcprswvfybudtopepuj` / `shorts_mvp` and AWS `181651591905`. No API, schema, worker, environment, account or lab change is required.

Scope: mobile hamburger drawer scrollbars and the showcase category menu scrollbar (below 768 px), retaining overflow auto, touch scrolling, keyboard navigation and desktop scrollbar behavior. Change only the requested Korean comment-style label; other two labels and translations remain unchanged. Preserve the five-second headline behavior.

Verification: existing showcase interaction regression tests, lint and production build, mobile/desktop browser checks on the exact unaliased candidate, protected-route manifest parity, admission fingerprint comparison. Promote the same verified deployment without rebuilding. Estimate: one local and one cloud build plus bounded read-only checks; at most one correction build if necessary. No new recurring resources or generation jobs. Evidence `/private/tmp/easycut-mobile-menu-20260929/`.
