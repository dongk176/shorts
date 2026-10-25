# Ranking Shorts Vercel execution candidate

## Boundary and baseline

Production change explicitly requested in the ranking-shorts conversation. Baseline is promoted
`da1a6d33dba9b36bebda72eecb86c34053715318`, deployment
`dpl_8HWTC9YaG4cYyzhdov9czsj2t9xb` (alias rechecked 2026-10-25).
Isolated branch `codex/ranking-vercel-20261025`; no lab code or lab services are used.

- Vercel: `artiroom/shorts`, `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`.
- Database: `mvcprswvfybudtopepuj`, `shorts_mvp`. Existing administrator-only authorization remains.
- AWS: `181651591905`, existing media bucket. Ordinary worker releases/queues are unchanged.
- Previous ranking ECS worker revision 9 remains available for rollback; it is not rebuilt.

## Execution and retention

`RANKING_EXECUTION_BACKEND=vercel` admits ranking operations to a per-project ephemeral Vercel
Sandbox. No database credentials are passed into it. Signed media capabilities bind method,
project, source and owner; internal commands use a separate derived session secret. Media
supports byte ranges and exact-origin CORS for seeking and canvas filmstrips.

All three social URLs prepare an actual downloaded preview on selection. Public-access,
duration and size gates remain in the shared renderer. Instagram/TikTok use direct egress;
YouTube uses the existing globally admitted Webshare pool and anonymous per-video PO provider.
Only bot/network failures may fail over, at most three leased routes. Private, age, payment,
geographic and DRM restrictions fail closed. No browser/account cookies or tokens are used.

Each sandbox has 2 vCPUs, a hard 30-minute lifetime and persistent storage disabled. At most
three sessions can be admitted. It stops after successful render, explicit reset or deletion.
Originals and normalized preview files remain only in ephemeral storage. Only final MP4 files
are uploaded to the existing `outputs/ranking/{project}/{operation}.mp4` location using a
presigned PUT for that exact object. Polling and the existing completion-email cron reconcile
results, allowing navigation away while rendering.

Snapshot `snap_oPJ18yU5RpDAiNHC4wJePDz3c1SQ` contains dependencies only: yt-dlp 2026.7.4,
provider 1.3.1 (server commit fbe4ed47f3b63cf061f1158f18f74bcc90e54033), yt-dlp-ejs 0.8.0,
Pillow 11.3.0, httpx 0.28.1, FFmpeg 8.0.1. Release code/assets are checksum-verified and
uploaded from the candidate's build artifact. `scripts/build-ranking-vercel-snapshot.mjs`
documents a clean dependency rebuild; never snapshot user workspaces.

## Additive configuration

Migration `20261025081932_ranking_vercel_sessions.sql` adds executor routing and private session
records. The legacy worker view exposes only ECS jobs so its startup reconciliation cannot
fail Vercel jobs. Existing rows default to ECS. The schema was tested with PGlite and applied
to the production schema before candidate testing.

New production environment keys affect new deployments only:
`RANKING_EXECUTION_BACKEND`, `RANKING_VERCEL_SNAPSHOT_ID`, `RANKING_PROXY_ROUTES_JSON` (sensitive).
The proxy value is the existing registry, not a new provider or subscription.

`RankingVercelResultsOnly` is an additive inline policy on the existing Vercel control-plane
role: only `s3:PutObject` for the existing bucket's `outputs/ranking/*`. Other inline policies
remain untouched. The equivalent CDK policy is included; no unrelated stack deployment occurs.

## Verification and release gates

Backend test on the candidate worker source: actual Instagram, TikTok and YouTube downloads,
206 range responses and exact-origin CORS. A 4-rank mixed-platform render includes 3 scratch
transitions and uploaded background music. Result: 11.021029 s, 720x1280 H.264/AAC; render/upload
9.479 s after sources were prepared. Contact-sheet inspection confirms ranking colors, dimmed
inactive labels and black transitions. This is not yet authenticated web-candidate validation.

Full `make verify` passed on the initial implementation. Final changes additionally rerun the
web suite, lint/typecheck, ranking Python tests (including synthetic FFmpeg integration), and
infrastructure synth. Web dependency Zod is patched to 4.6.6 including Vercel transitive copies;
package audit has zero reported vulnerabilities.

Before promotion: commit clean tree, deploy unaliased production candidate, compare route
manifest with baseline, verify `/`, `/guidebook`, `/pricing`, admin and editor, anonymous and
non-admin ranking denial, then perform authenticated trim/sequence-preview/render/project
progress tests. Promote that exact verified deployment, without rebuilding. Record deployed
ID and final test evidence separately. Remove temporary auth callback entries after testing.

Bounded ordinary test usage is authorized: each test workspace has <=12 minutes lifetime,
2 vCPUs, stop in finally, temporary DB rows/leases and result objects cleaned. Estimated
incremental compute/transfer is a few dollars for this bounded migration verification;
no always-on capacity or new fixed commitment is created.

## Rollback

Promote the retained previous deployment if needed; existing ranking jobs keep their executor
and old runtime references. Do not remove the migration or snapshot while live Vercel jobs
exist. Reconciliation must remain available until they settle. New rollout defaults may be
removed only after confirming no live Vercel workspaces/jobs. Preserve stored completed results
and the legacy ECS revision. Do not enable ordinary worker capacity as part of this change.
