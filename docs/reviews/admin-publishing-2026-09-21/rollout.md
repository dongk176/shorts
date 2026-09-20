# Administrator TikTok publishing release

User authorization (2026-09-21): deploy an administrator-only upload workflow on the official site, without exposing it to ordinary users, for review recording. This is a narrow exception to the earlier production publishing exclusion. YouTube publishing, content calendar, its OAuth APIs, migrations, and uploader infrastructure remain excluded.

Baseline: promoted production `bf137f86aea3ecaa0ffbe5e2db89352701a2afa2`, deployment `dpl_HQTxYdYx2ontFND1zt1WiMnJhdoM`. Candidate branch `codex/admin-publishing-production-20260921`. TikTok protocol/UI selectively adapted from local review commit `01b25158644109c23b4aafd132b8449fc363ed3f`; no wholesale merge. Production AWS 181651591905, Vercel prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw, Supabase mvcprswvfybudtopepuj / shorts_mvp. Lab is not involved.

## Exposure and data boundaries

- Server database role (`is_admin` and not withdrawn) controls the initial Upload button and every authenticated TikTok handler. The default is OFF. Nonadministrators cannot enable this with browser flags or direct API requests.
- Only administrator-owned, available finished shorts in non-example, non-deleted projects can be posted. Existing editor/download/billing/worker logic is unchanged.
- Existing Sandbox client; canonical production HTTPS origin; only `SELF_ONLY` publishing. This is temporary review access, not a public production launch or a claim of TikTok approval.
- Five new RLS-enabled tables; no anonymous/authenticated grants. Tokens are encrypted with a separate server key. No token appears in client responses. Withdrawal and disconnect remove stored grant/post data. Provider revocation failure displays manual instructions.
- Posting is disabled until both the environment flag and the recorded TikTok origin verification are present. Domain verification is recorded only after the developer console confirms it.
- TikTok receives an expiring 90-minute random capability URL, invalidated on disconnection/source changes/completion. The official origin streams existing private CloudFront output bytes; it does not redirect or expose signed storage URLs. No source-video storage or new worker infrastructure.
- MP4 metadata probes use bounded ranges (moov at most 8 MiB), immutable key/ETag/size identity, and validated duration/dimensions/codec/fps. Transfer limit 250 MiB. Provider requests are bounded, init is deduplicated, and ambiguous results are not blindly resubmitted.

## Verification before candidate deployment

- Web suite: 2,862 passed, 132 skipped (pre-existing optional coverage); 365 test files passed, 5 skipped.
- Lint, TypeScript, Next production build passed.
- Real FFmpeg output at both moov locations matches ffprobe; identity/range/size/path checks, OAuth session binding, ownership, deduplication, revocation, withdrawal and nonadministrator endpoint denial tested.
- Production migration applied as a single guarded transaction; only the new administrator TikTok migration was applied. Every new table has RLS enabled.
- Candidate must retain baseline protected routes, pass unaliased candidate checks, and be promoted without rebuilding. Actual deployment and browser results recorded separately after testing.

## Rollback

Promote the previous deployment `dpl_HQTxYdYx2ontFND1zt1WiMnJhdoM` (unless superseded by another release). It has no publishing UI/API. Keep additive tables and encrypted data for investigation; do not drop tables or modify customer records to roll back. Clearing tiktok_review_settings.verified_at disables media delivery/creation immediately in this candidate. Do not change existing worker capacity or database projects.

## Recording

Use the official `/en/projects/<owned project>` page. Connect the existing Sandbox target account, choose Only me explicitly, leave AI/commercial disclosures off for a synthetic test pattern, confirm rights/transmission, show posting progress and completion, inspect the private video in TikTok, and disconnect. Existing unreviewed-app account/privacy restrictions still apply. Do not claim public posting is enabled.
