# Lower-cost showcase delivery

User requested minimizing showcase delivery cost. Production baseline read from live Vercel alias: `bafbaf55c51e6d4db798afe7d5edd0e9bfc08c39`, deployment `dpl_6e42Xhh4LEuvvZFiotowBxkcW411`, existing project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`. Work continues in `.tmp/showcase-geo-release-20260927` / `codex/showcase-geo-release-20260927`; the only intervening commit records the last release.

## Storage and environment boundary

AWS STS independently returned account `181651591905`. Existing public-content CDN `E3NYPMMRTFR2KF` / `d1mzwx29nljvyq.cloudfront.net` uses existing S3 bucket `artiroom-uploader` in ap-northeast-2 and OAC `E3LYTAOG0IHSQ2`. Read live distribution and bucket policies before using them. S3 blocks all public access and grants this CloudFront distribution read access; no lifecycle rule deletes the new assets. The private customer-output distribution `E6R990OAL66MU`, its signatures and guards remain untouched. No account/DB/worker configuration, infrastructure, ACL/policy or pricing-plan changes. No new recurring commitment.

Only approved public showcase excerpts and their posters are uploaded to `easycut/showcase/v2/`. These are short rendered excerpts, not full source videos. Filenames include the actual content hash. The upload tool asserts AWS account, distribution/origin, expected bucket owner, filename and local digest, and verifies every object with HEAD. Metadata includes SHA256; responses use the correct media type and a one-year immutable cache header.

## Optimization

- Existing 72 approved MP4 renders: 411,391,903 bytes -> 129,641,406 bytes (68.5% reduction). Shorts use 540x960 H.264, source previews 960x540, 24fps, 64kbps mono AAC, faststart. All retain audio and duration (within frame rounding). No content regeneration.
- All 72 posters are WebP, totaling 2,343,062 bytes. Both the showroom and localized galleries use these same cached files directly from CloudFront.
- Initial SSR renders posters with no video `src` and `preload=none`. Only the selected center Short loads/plays while the showroom is visible and the document is active. Inactive resources are detached and reset to stop buffering. Source preview loads only on explicit click; the expanded player's pause preserves its playback position. Existing reduced-motion behavior is retained.
- Default talk selection video budget (full download, no browser cache): KO 15,966,782 -> 1,679,637 bytes (89.5% less); EN 14,322,264 -> 2,189,101 (84.7% less); JA 12,944,250 -> 909,236 (93.0% less). These comparisons exclude posters/other page assets and additional user-selected clips, and are not measured monthly savings.
- Browser requests target CloudFront directly; no Vercel proxy or signed-URL endpoint. Original local master assets remain available for re-encoding/rollback but are excluded from Vercel upload via `.vercelignore`.

Estimated new usage is ~132 MB storage plus bounded upload/verification requests on existing services. Actual ongoing charges depend on existing account allowances and traffic. No claim of zero AWS cost or a new flat-rate plan.

## Verification plan and completed local checks

Encoding script probes every output for dimensions, duration and audio. Sample text/readability visually checked. All 144 objects uploaded and verified; CDN sample HEAD returned expected type/size/cache header, while direct anonymous S3 access returned 403. Local first-render tests (12), scoped ESLint and full production build passed. Before promotion: route parity, actual candidate protected routes/admission checks, all CDN objects and byte-range delivery, browser loading/selection/mute/source preview/mobile checks. Recheck current alias and promote only the tested deployment; then repeat live checks.

## Completed release

- Exact deployed source: `8e4e46bb740a970775f973e67243482ec841781b`; deployment `dpl_Amuc2KHKS6XbFxYohg176Kuybq1M`, URL `https://shorts-2fg857pxl-artiroom.vercel.app`. Verified the previous production alias was unchanged immediately before promoting this exact candidate to `https://www.easycut.co.kr`.
- Candidate and production checks passed: protected routes, locale behavior, route parity, all 144 CDN object sizes/cache headers, 206 byte-range delivery and the unchanged five-target job-admission fingerprint. Old showcase master path returns 404 from Vercel, confirming exclusion. Browser verified live CloudFront playback.
- Browser: initial home has four poster-only videos with no `src`, paused and readyState 0; visible showroom loads only the center clip. Switching selection detaches the previous resource, mute enables only the selected clip, opening the original detaches all showroom streams, original pause preserves position, and returning above the showroom detaches all streams. English and Japanese playback passed; Japanese mobile at 390px had no horizontal overflow and only one active video.
- Sample CloudFront full GET followed by HEAD returned `Hit from cloudfront`, confirming cache reuse; initial cold or immediate requests can return MISS. S3 anonymous access remains 403. No CDN/S3 policy or pricing changes occurred.
- Immediate five-minute deployment error scan returned zero entries. Evidence: `/tmp/showcase-cost-20260927/{candidate,production}-verification.json`, `/tmp/showcase-cost-*.log`, and `/tmp/showcase-delivery-v2/metrics.json`. This is bounded verification, not ongoing traffic/billing measurement.
- Later documentation-only commits are not the deployed code; use the exact source above. Rollback is the previous immutable Vercel deployment; approved masters remain in Git/local storage. Content-addressed AWS objects must remain while referenced by this deployment.
