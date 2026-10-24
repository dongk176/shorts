# Ranking shorts administrator release candidate

Target: explicitly authorized production addition, administrator-only. No promotion yet.
Baseline verified 2026-10-24 through www.easycut.co.kr alias and raw deployment API:
`dpl_Bupw2mFVGzAJYbgavcksRfUuvYaE`, commit `96cd3057a3590a511fb49f29f195f3262021e210`.
Worktree `.tmp/ranking-admin-production-20261024`, branch `codex/ranking-admin-production-20261024`.
Preserve latest template/editor fixes, publishing maintenance, all existing routes.

## Configuration and isolation

- Vercel production project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ` verified read-only.
- Supabase production `mvcprswvfybudtopepuj`, PostgreSQL 17, `shorts_mvp.app_users` verified; ranking tables absent before work.
- AWS expected `181651591905`; CLI expired at start. Exact receiver, listener, VPC origin, network, role and image revisions pending fresh authentication/inventory. No remote AWS changes before this check.
- Code baseline is production, not lab. Existing lab is not used or presumed equivalent.
- Local-only prototype source is copied selectively; no unrelated dirty checkout changes are included.
- Separate ranking tables, operation queue, completion outbox, ECS service and capacity lane. No modifications to ordinary job admission, charges, worker targets or upload service revision.
- Full originals and normalized full-length previews remain on task ephemeral storage. Only final MP4 under `outputs/ranking/` is persisted to existing media bucket, with private signed downloads and application access capped at 30 days; actual bucket lifecycle must be verified before release.
- Proposed receiver uses an isolated target group on the existing receiver load balancer and a separate pay-per-use CloudFront distribution reusing the existing VPC origin; existing listener routes must remain intact. No new always-on ALB or database project. Desired count zero when idle; bounded one-task ranking capacity. Verify existing infrastructure supports this before deployment.

## Verification requirements

Admin/guest/non-admin/other-owner page and API access; CSRF, capabilities and expiration;
source limits and upload interruption; duplicate requests; task loss and bounded failure;
remote import and three-clip render; exact source ranges/order/title; result access and
completion email idempotency/retry; no source in S3; source cleanup; worker identity;
protected route manifest parity; staged production candidate tests; same deployment promotion.
Ordinary bounded test budget estimate: one task, <=2 hours active, <=3 render attempts,
<=3 short remote samples, existing storage/email only; record actual usage after tests.

## Local implementation and evidence (not cloud verification)

- Latest production alias rechecked after implementation: still `96cd3057a3590a511fb49f29f195f3262021e210`, deployment above.
- Local PostgreSQL 16 disposable database only; production is PostgreSQL 17. Migration is not applied remotely.
- Ranking data stays in `shorts_mvp`. A private `shorts_ranking_runtime` view/function schema exposes only ranking data and administrator IDs. No `public` changes.
- Production read-only privilege audit found existing PUBLIC-executable SECURITY DEFINER job functions in `shorts_mvp`; worker is deliberately NOT granted USAGE there. Its startup rejects a wrong role or ordinary-schema access. Existing permissions/functions remain untouched.
- Actual FFmpeg import/render via restricted role: three clips, selected ranges, explicit order, final MP4 only passed to a fake S3 adapter, completion outbox written. This does NOT prove actual AWS S3 delivery or email provider delivery.
- Receiver tests cover owner/admin revocation, upload size/reuse/cancellation, source expiry, range requests and lost tasks. Browser DB roles are denied. Restricted worker cannot access ordinary schema/email or rewrite render requests.
- Frontend API/domain tests: 41 passed against local DB. Separate worker service/capacity tests: 20 passed. Renderer tests: 35 passed, including FFmpeg/ffprobe synthetic integration. Infrastructure ranking tests: 3 passed.
- TypeScript and frontend lint passed. Production build passed before final robustness additions; final full checks recorded below when complete.
- Route manifest comparison to the exact production-baseline build: no removed routes; only ranking page/API/cron additions.

## Remaining release dependencies

AWS CLI authentication remains expired; no AWS, DB, secret, Vercel environment or production deployment changes have been made. Do not enable the feature until all of these are verified:

1. Authenticate and verify AWS account 181651591905; inspect exact existing ECS upload task revision/image, listener rules/priorities, CloudFront origin/path behavior and secret header, networking, web role, bucket encryption/retention and existing secret.
2. Confirm private worker views cannot execute ordinary schema functions on PG17; install additive migration and restricted login without broadening existing grants. Keep passwords out of files/logs and reuse existing secret fields.
3. Confirm a supported public video ingestion route and bounded routing configuration. Current pipeline has direct public yt-dlp ingestion; actual AWS YouTube/Instagram/TikTok acquisition and any necessary managed route integration remain unverified. Never reuse ordinary ingestion capacity without its existing admission controls.
4. Build/pin worker image from the final clean source commit. Match worker attestation and CDK inventory. Validate path-only routing and exact admin candidate CORS. Deploy isolated service with desired count zero.
5. Test authenticated admin and non-admin against the unaliased web candidate, file/link import, render range/order/title, signed playback/download, actual completion email, restart/expiration, and ordinary-page smoke tests. Verify S3 has no full source uploads, and existing bucket retention covers ranking results.
6. Recheck current production baseline and route manifest, promote the exact tested candidate without rebuilding, observe ordinary jobs and return ranking capacity to zero.

## Final local checks

`make verify` completed successfully: script tests (215), worker suite (optional/external checks skipped), frontend (3,806 passed / 168 skipped), CDK (39), lint, TypeScript, production build, and standard infrastructure synth. This is local verification, not deployed-environment verification. The final result-page/history refinements are followed by a fresh frontend build; ranking infrastructure tests/types are rerun after the receiver isolation change. Separate real-DB worker/capacity tests (20) and web access/workflow tests pass against the disposable local database.

Feature-OFF browser smoke: `/ranking-shorts` displays 404 and the ordinary home sidebar has no ranking item. Authenticated feature-ON browser testing remains required on the unaliased candidate. Baseline and final route manifests retain all existing page/API routes.

The baseline upload listener has a priority-1 origin-header rule. A path-only rule behind it would wrongly reach the existing receiver. The candidate now uses a NEW distinct ranking origin secret and an isolated metered CloudFront distribution referencing the existing VPC origin. Both path and ranking header must match its new listener rule. Existing distribution/listener rules are not modified. Before deployment, verify the distinct secret differs from the ordinary receiver secret, and confirm the observed live rule set matches this assumption. No new ALB, NAT, database, VPC origin, or idle ECS capacity is provisioned by the ranking stack.

AWS reference for reusing VPC origins: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html

Final frontend rebuild after result-page/history changes passed. Route manifest has 0 removed / 9 added entries. All remote mutations remain pending. Browser automation review denied observation of the normal-profile AWS sign-in page, citing an isolated-login-window/profile requirement; no workaround was attempted. User authentication is required; exact AWS identity remains unverified until STS succeeds.

## Authenticated production inventory — 2026-10-24

User completed the AWS CLI login in a new Chrome incognito window. STS verified account `181651591905`. Current web alias still points to `96cd3057a3590a511fb49f29f195f3262021e210`. Runtime DB identity is PostgreSQL 17.6, `postgres.mvcprswvfybudtopepuj` pooler tenant, database/user `postgres`; public Supabase custom domain is `easycut.supabase.co`. Ranking tables/role are absent before migration.

Existing upload service remains desired/running 0; task definition `shorts-mvp-file-upload-production:14`, image digest `sha256:357afd6f412720043d128a3e00dfffa1507e9ff3f55e95e6cb692df0f1d9b037`. Its priority-1 header rule and 403 default match the expected isolation design. Existing VPC origin `vo_Dc7FYwJ2oyZDiqvxBwyoFA` and CloudFront `ENOIJWSFW4XKW` are retained. Existing output bucket uses AES256 and its `outputs/` lifecycle expires objects after 30 days, including ranking outputs. No original/preview object storage will be added.

## Webshare admission correction (2026-10-24)

The actual AWS candidate reproduced YouTube bot challenges on direct egress.
Direct per-video attestation did not resolve that challenge; the inactive legacy
WARP configuration also failed its bounded connectivity probe. Neither is enabled.
The requested production path now uses the existing `INGESTION_PROXY_ROUTES_JSON`
Webshare pool, injected only into the isolated ranking receiver.

`20261024110000_ranking_webshare_admission.sql` adds a separate 10-minute ranking
lease to each existing IP slot. The three existing admission functions keep their
live production definitions and permissions; a hash guard refuses deployment if
any definition has changed since inspection. Only their free-slot predicates gain
an exclusion for an active ranking lease. Ordinary job leases, queue ordering,
usage, retries and release logic remain intact. Ranking receives only two narrow
SECURITY DEFINER functions in its private schema, not access to ordinary tables.
At most one ranking acquisition can hold an IP globally; acquisition and download
share that lease, release it in `finally`, and expire after receiver loss. The
pipeline deadline (540 seconds) is shorter than the lease (600 seconds). Restricted
content fails closed before transient classification; only bot/429, network errors,
and metadata-gated media 403 can rotate. Up to 20 distinct configured routes,
60 seconds capacity wait, and the overall deadline bound retries. Route IDs and
categories are audited without proxy credentials, account material or raw stderr.

Actual cloud test before this correction: web `8187d6b`, worker `befbe035` on ECS
revision 2 generated operation `ccd84ed2-66ab-44d3-9cac-57cb677ecf8f`.
Three sources (file, Instagram, TikTok), custom playback `[2,3,1]`, ranges `[4,8]`,
`[1,4]`, `[2,5]`, SUIT/mint/custom white title and right-side ranks produced
720×1280 H.264/AAC, 300 frames at 30fps, 10.021333s. The authenticated browser
loaded the finished video with readyState 4. Completion email was accepted by the
provider, outbox status `sent`, attempt count 1. Browser automation's download
navigation encountered ERR_BLOCKED_BY_CLIENT; storage retrieval and embedded
playback succeeded, so the final end-user download flow still needs confirmation.

Follow-up: the normal UI download button succeeded; downloaded file SHA-256
`929151bd32f05949801846b06b3893498a8eaf6fe5e38bf71c857f3248c7a769`
exactly matches the stored test result. The earlier automation helper was the
failing path, not the end-user download action.

The isolated receiver's restrictive egress policy needed the actual Webshare
ports. Inventory now includes 20 public `/32` destinations and exact ports,
validated against the existing secret without persisting credentials. Proxy
replacement must refresh this inventory and security group as well as the secret.
The legacy WARP probe's network failure does not establish that its old account
configuration is invalid: this security group did not allow WARP's UDP transport.
After the Webshare rules were applied, YouTube metadata acquisition succeeded on
`webshare-20`, with the first bot-challenged route released before failover.
The exact currently promoted ordinary worker also enables the pinned bgutil
public-video attestation provider with the mweb client. Ranking now has a separate
`RANKING_YOUTUBE_PO_TOKEN_ENABLED` gate, validates that pinned runtime, and uses
that same public, cookie-free configuration on the leased Webshare path. Instagram
and TikTok retain disabled plugins. The existing ordinary worker is unchanged.

## 2026-10-24: instant browser players

- Baseline: promoted `dfd973ceab887f9920591485c6f84eb4d2a0e04d`, deployment
  `dpl_DyxtxFDQZ3Ud5csM6sDNsu96ScdR`. Isolated worktree branch
  `codex/ranking-instant-player-20261024`.
- Full YouTube and TikTok links mount an allowlisted browser embed immediately.
  Connecting these links performs no ranking API request, ECS wake, metadata
  inspection, proxy request or source download. Player duration drives the trim
  timeline; TikTok may require pressing play before it reports duration.
- Source registration/inspection is deferred until Make video. Each resolved
  server source replaces the provisional ID; selected ranges, ranks, custom
  order and design remain unchanged. Server duration is revalidated before
  submitting render. Successful registrations are retained for retry.
- Embed failure never silently triggers a download for YouTube/TikTok. Original
  links/file upload remain available. Instagram and redirect-only short URLs
  retain their existing server preparation path.
- Production configuration remains the same: Vercel project
  `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, Supabase `mvcprswvfybudtopepuj` /
  `shorts_mvp`, production ranking ECS task revision 5 and worker source
  `0c950c50971f6533e1c053a5cc0442b094600565`. No schema, worker, IAM, proxy pool,
  ordinary user path, or publishing gate changes.
- Verification plan: exact unaliased candidate, direct browser playback and
  trim followed by one bounded two-source render on existing production ranking
  resources. Expected ordinary test cost below KRW 1,000, no recurring resources.
  Existing user jobs must not be stopped during cleanup. Lab is not used and is
  not assumed to mirror production.
