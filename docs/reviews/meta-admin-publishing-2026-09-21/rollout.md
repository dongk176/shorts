# Instagram and Threads administrator publishing

User authorization: 2026-09-21, extend the deployed administrator-only Upload workflow to Instagram and Threads for real web testing. This is a narrow exception to the old publishing exclusion. YouTube publishing/content-calendar and Facebook publishing remain excluded.

## Baseline and configuration

- Promoted baseline: f168399ee8a7beb6785183817c338edc7365ced9, dpl_Gqzmz93FWzu9MUK1SvjCQRDX8qqZ, shorts-mnlt818n3-artiroom.vercel.app. Reconfirmed at 12:03 KST.
- Isolated source: .tmp/meta-publishing-production-20260921, codex/meta-publishing-production-20260921.
- Target: production Vercel prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw / artiroom, Supabase mvcprswvfybudtopepuj / shorts_mvp; existing AWS 181651591905 outputs and CloudFront delivery. No worker, billing or infrastructure change. Lab is not used.
- Database identity was checked read-only: exact expected pooler host/username, postgres database/role; existing TikTok tables present; Meta tables absent before this release. Intended administrator remains active and is_admin=true.
- New server-only variables: META_PUBLISHING_MODE=admin-review, META_TOKEN_KEY (base64 32-byte encryption key), INSTAGRAM_APP_ID=1116489420856814, INSTAGRAM_APP_SECRET, THREADS_APP_ID=1083482200733575, THREADS_APP_SECRET, META_GRAPH_VERSION=v26.0. Existing production secrets and TikTok configuration remain intact.
- Canonical callbacks: https://www.easycut.co.kr/api/social/instagram/oauth/callback and https://www.easycut.co.kr/api/social/threads/oauth/callback. OAuth must start on this canonical origin to keep its session binding.
- Optional deauthorization callbacks: the corresponding /api/social/{platform}/deauthorize. They require the matching app's HMAC-signed request. Data deletion instructions: https://www.easycut.co.kr/privacy#meta-publishing.
- App 2307294366687280 remains unpublished. Instagram tester k_dong176 and Threads tester baedu_0824 accepted invitations. Invitations are not OAuth grants. App secrets initially require Facebook reauthentication in the developer console.

## Behavior and boundaries

Only the existing database administrator role sees Upload. Every authenticated endpoint rechecks the current role, active app user and ownership of an available, ready, non-example finished short. The Meta feature requires the exact production Vercel/DB identity. Capability delivery also requires the current role, grant/version, original render/key/fingerprint and a 90-minute expiry. General users cannot gain access through direct requests or browser flags.

The upload dialog offers platform tabs, first-time connection, caption and account selection, two unchecked acknowledgements of rights and publication, progress/result overlays and returned post permalinks. Instagram Reels are publicly visible; Threads uses profile visibility. No Only me setting is fabricated. The dialog must stay open to check processing and finalize a previously confirmed publication.

The additive migration creates only shorts_mvp Meta tables with RLS and no anon/authenticated grants. Tokens use a separate AES-256-GCM key with app/user/purpose binding. OAuth state is random, one-use, expiring, bound to session/user/app/project and invalidated by disconnect. Withdrawal and disconnect delete stored Meta grants and local post history; provider revocation failure explicitly requires manual removal in platform settings. Published platform content is not deleted. Signed deauthorization hashes prevent callback replay and contain no account identifiers; old receipts are purged after 90 days on callback processing.

Container creation is deduplicated by owner/short/render/connection. Only a definitive failure permits a new explicitly requested attempt; failed history is retained. The attempt to publish is committed before contacting Meta. An ambiguous response is never blindly retried; later checks inspect the same container. Provider-confirmed success is persisted before best-effort permalink lookup. Existing private finished media are streamed; no new source-video storage or public bucket is created.

## Protocol sources checked

- Instagram Login authorization/token exchange and granted scopes: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
- Instagram Login profile fields and v26.0 examples: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started
- Instagram Reels two-stage publishing: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
- Threads OAuth currently documents threads.com and graph.threads.com: https://developers.facebook.com/documentation/threads/get-started/get-access-tokens-and-permissions
- Threads token validity/scopes: https://developers.facebook.com/documentation/threads/reference/debug
- Threads two-stage publishing and container status: https://github.com/fbsamples/threads_api/blob/main/src/index.js

## Verification and release gates

Final focused verification: 68 tests passed, including actual isolated PostgreSQL migration/constraints, Instagram/Threads provider-contract fixtures, role/ownership/session boundaries, partial grants, source changes, deduplication, lost-response recovery, disconnection, withdrawal, signed requests and localized unchecked-consent UI. Provider responses in these tests are mocked; this does not prove live Meta permissions or successful live posting.

Final full web verification passed: 370 test files passed (5 skipped), 2,884 tests passed (132 skipped), and the Next.js production build completed with lint/type checks. The build emits an optional canvas-module warning through the existing caption-preview budoux/linkedom dependency; that dependency and caption code were not changed. Local route comparison preserves all 210 baseline routes and adds 9 Meta API routes; all five protected routes, including /projects/[projectNumber]/edit/[shortId], remain present. This local build is not an unaliased deployment check. Before promotion: compare actual candidate and baseline route manifests; preserve /, /guidebook, /pricing, /admin/easycutcutcutcutcutcut and editor paths; inspect authenticated administrator and nonadministrator behavior. Deploy an unaliased candidate and promote that exact deployment, without rebuilding. Record exact source/deployment and observed live results separately. Do not describe a disabled connection button or a mocked publish as a successful deployed test.

Ordinary bounded build/API/temporary transfer costs are covered by standing approval; expected existing-service metered usage is small (one candidate build and a short finished-video test per provider). No new recurring resources are created.

Rollback: promote the previous confirmed deployment, if it is still the preceding release, or disable META_PUBLISHING_MODE for the next deployment. Retain additive tables for inspection; do not drop customer data or alter TikTok records to roll back.

## Current handoff (12:10 KST)

The Meta developer console requires the user's existing Facebook password before displaying the app secret. The user was asked to complete that reauthentication directly in the open Chrome EasyCut use-case page; no password was requested in chat. This is the remaining external authentication dependency, not a new cost or deployment approval request.

No production Meta migration, environment change, candidate deployment, promotion, OAuth grant or real Meta publication has been performed at this handoff. Continue from the tested isolated source once reauthentication is complete. Obtain the two existing app secrets without logging them, configure the two minimum publishing permission sets and exact canonical callbacks, apply the guarded additive migration and server-only environment variables, then verify and promote an unaliased production candidate. General-user behavior remains the currently promoted f168399e release until that promotion.

## Configuration applied after user reauthentication

Both existing app secrets are saved as sensitive production-only Vercel variables, together with the separate encryption key, app IDs, graph version and administrator feature flag (7 variables). Secret values were not printed or committed. Instagram basic/content-publish and Threads content-publish were added to the app review draft and show ready for testing; Threads basic was already ready. No app review was submitted and no end-user grant was accepted.

The guarded additive production migration completed on mvcprswvfybudtopepuj/shorts_mvp. All 5 Meta tables have RLS and no public/anon/authenticated grants. Migration SHA-256: 0bb46d101eb0ce8fa2666c82b757693a8e9db01880330d80beb387ec602dd459. Existing application data and worker settings were not modified. The exact 9 authorized Meta routes were added to the release guard; its 7 tests passed, including rejection of unrelated public/YouTube OAuth routes.

Production remains f168399e until the candidate passes the deployed checks below and is explicitly promoted within the user's existing authorization.


## Promoted deployment and live checks

The exact unaliased candidate `dpl_BJq3oCc2A92onbGasvQATUYEQWxm` (`shorts-36hjk7gf1-artiroom.vercel.app`), source `8aded1de84ec60732a4a96165676826c5520c8aa`, passed the release gates and was promoted without rebuilding. The previous production target was rechecked immediately before promotion and still matched f168399e. The post-promotion Vercel target matches 8aded1de. This record commit is documentation only and was not included in the deployed source.

The actual remote build contains 219 routes, preserving all 210 baseline routes. Candidate anonymous protected-path/endpoint checks passed. A temporary ordinary account received 403 on all 14 Instagram/Threads authenticated API cases and on TikTok; the account was removed after testing. The existing owner administrator received 200 on connection lists, post history, preview HEAD requests, project/editor pages and TikTok; malformed empty posts were rejected with 400 and did not publish anything. The HTTP project check verifies adminPublishingEnabled=true: Upload is a client-only component, so its absence from initial HTML is expected. The first HTML button assertion was corrected rather than changing the product. Actual promoted browser UI shows Upload, Instagram and Threads, and an enabled Instagram Connect account button.

The candidate's existing job-admission verifier passed with all 5 registered targets and fingerprint `668676b0a45b9376e76461fdd8f11367524e4a2bf08695ddc13aa62c267964f4`. Official www.easycut.co.kr checks also passed for home, guidebook, pricing, editor login gate, admin redirect, privacy and terms. All 3 publishing platform APIs return 401 without authentication. The new Meta privacy notice is present. Excluded YouTube OAuth and content-calendar routes remain 404. No new worker job was needed or started.

Instagram's saved canonical callback was accepted by the live authorization flow, which reached EasyCut-IG consent for k_dong176 with profile/media and content-publish permissions. The user was asked to approve that new account grant directly; no actual grant or post has yet been verified in this record. Threads callback chips disappear after saving/reloading Meta settings, without a visible error. A direct manual save was requested; Threads end-to-end authorization remains unverified. Do not describe either platform as successfully published until the live account and post checks finish. Full sanitized evidence is in deployment-verification.json.
