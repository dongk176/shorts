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

## Local validation completed

Feature commit `68a7cdc4384c10a284928fb970f649b5584f5895`:
92 tests across 9 files passed, including the actual release migration, reviewer
scope, source cleanup, OAuth/disconnect/retention and English/Japanese UI.
The final Next build passed lint and type checking. Existing optional canvas
warning remains. Release route verification passed against the prior local
production-baseline build manifest; this is not a comparison of remote candidate
and promoted deployment manifests. Remote validation is still required.

The user was asked via the pending approval question to authorize persistent
shared-production Vercel OAuth/key/grant configuration and reviewer-only deployment.
No response has been received at the time of this record. This must not be treated
as approval. The first environment command was rejected before execution, so its
configuration script was not created and no seven environment keys were saved.

Draft account instructions are in `.secrets/youtube-reviewer-instructions.txt`.
The application draft lists remaining access/organization/routing questions;
it is not a submitted form or a completed compliance attestation.

## Shared upload window correction

The user clarified that YouTube belongs in the existing TikTok/Instagram/Threads
upload window, and requested YouTube first. The project now renders a single
upload button and shared dialog. YouTube's connection/metadata panel is embedded
in that dialog; its old standalone upload button/dialog and placeholder platform
tabs are removed. Available tabs are ordered YouTube, TikTok, Instagram, Threads;
manual opening selects the first available tab, while OAuth returns restore the
corresponding provider. Existing per-account server grants remain unchanged.
Localized YouTube return paths are normalized to the server's existing allowlist.

105 tests passed across 12 files: one dialog/button, tab ordering and selection,
YouTube OAuth restoration, existing Meta/TikTok panels, reviewer platform isolation,
and the YouTube backend tests. No production settings or deployment were changed
by this UI correction; the prior explicit approval block remains unresolved.

## User-approved continuation

After the explicit question describing persistent shared-production OAuth keys,
encryption keys, reviewer grant and candidate verification/promotion, the user
confirmed the remaining steps and said "ㄱㄱ". This authorizes that production
configuration/deployment scope. A fresh Vercel read still identifies promoted
baseline 700e4c7d / dpl_BNeaz79Jk76847V414nZTpsz2u7h. The configuration action was
resubmitted with this new authorization and succeeded: seven server keys were
added to the production environment. This records a successful tool result; it
does not retroactively describe the earlier rejection as approved. New provider
scopes, general-user access and a final legal audit attestation are not implied.
