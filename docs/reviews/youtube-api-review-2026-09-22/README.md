# YouTube reviewer candidate — 2026-09-22

Status: local implementation and dedicated fixture prepared. No new deployment,
OAuth redirect registration, reviewer environment variables or API audit submission yet.

- User requested that Codex prepare the reviewer URL, account, sample and application.
- Source baseline: live promoted production `700e4c7d6c56c091d58a8b9bcdac0591754ef5dc`,
  deployment `dpl_BNeaz79Jk76847V414nZTpsz2u7h`, freshly read from Vercel REST.
- Worktree `.tmp/youtube-api-review-20260922`, branch `codex/youtube-api-review-20260922`.
- Code and account configuration are separate: this candidate uses the current
  production code baseline and existing production resources, never a lab mirror.
- Vercel project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, DB
  `mvcprswvfybudtopepuj` / `shorts_mvp`, AWS `181651591905` verified after user login.

## Scope and implemented gates

The existing locally verified per-user YouTube connection/upload code is adapted
for one non-admin reviewer and one owned synthetic clip. Runtime validates the
exact Vercel project, production target, DB host/user and approved Google client.
It rejects other users, other clips, withdrawn users, expired access, deleted
projects and unfinished/expired clips. Hosted review always forces private uploads,
even if the old local non-private flag is enabled. No uploader worker, calendar,
additional OAuth scope, paid plan or recurring infrastructure is introduced.

Server downloads finished output through the existing signed media path into a
random temporary directory; size is capped at 25 MiB, transfer timeout 60 seconds,
upload request budget 210 seconds, cleanup in finally. Owner/connection/version
checks remain before and during provider requests. Tokens and resumable URLs stay
encrypted. Disconnect, withdrawal and hourly retention erase integration data.

Existing English/Japanese UI and existing demonstration recordings are reused.
The published video remains https://www.youtube.com/watch?v=HVyqEUeRbuc;
its localhost flow is historical evidence, not proof of this hosted candidate.

## Actual remote changes completed

- Dedicated managed login `youtube-review-20260922`, non-admin, zero production
  credits. One owned synthetic output in project `14899`; review media expires
  `2026-10-20T16:06:47.493Z`. Login service allowance is 370 days, not a claim of
  automatic account deletion at that date. Private credentials only in ignored
  `.secrets/reviewer-plan.json`.
- Applied `supabase/migrations/202609220001_youtube_reviewer_accounts.sql` to the
  fixed production database, after confirming no earlier youtube_account tables.
  Four new tables have RLS enabled and no browser read policies. The migration
  was tested against embedded PostgreSQL; exact hash and resulting tables are
  in local evidence. Existing user data was not copied or altered.
- Estimated bounded metered expense: under US$2 for existing storage, transfer
  and candidate build. No new fixed recurring resource.

## Automatic approval block

Adding seven persistent production environment keys was rejected before execution.
The reviewer cited shared production configuration and lack of guaranteed separate
runtime isolation. No secret/env key was saved by that action. Do not retry or use
another path to apply it without resolving this explicit block. Remaining local
checks and documentation can proceed. User approval must identify shared production
Vercel configuration, reviewer-only access, encrypted credentials and same-candidate
verification/promotion; do not call this an independent cloud environment.

## Remaining verification

- Final source commit; exact local route comparison and release checks.
- Approved environment configuration and separate unaliased candidate deployment.
- Candidate checks: general-user denial, reviewer login, owned media Range response,
  cross-user isolation, exact approved OAuth scope/client/redirect URL.
- Register https://www.easycut.co.kr/api/youtube/accounts/oauth/callback on the
  existing Google OAuth client, retain existing callback URLs.
- Verify protected production routes before promoting that exact candidate.
- Verify actual hosted connection/private upload/deletion as authorized; do not
  represent mock provider tests as live upload verification.
- Prepare application screenshots, access instructions and truthful full-service
  description. Final legal acknowledgments and submission are not completed.
