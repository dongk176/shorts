# Admin-only midform candidate

Status: implementation and local verification complete; production runtime
verification and promotion pending. Runtime verification rows must come from real checks.

## Source and environment

The web/link candidate starts at the promoted production commit
`a2893f37fa1b96cc3883a170aa1fdd915edc133e` (deployment
`dpl_Bb8c7zYnsvghXUfDXpMwe1g2A6DT`). Check the alias again before release.
Production is AWS `181651591905`, Vercel `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`,
Supabase `mvcprswvfybudtopepuj`, schema `shorts_mvp`.

The existing upload receiver is independently pinned to source
`ad83422e4a94bbe3a3cddd7c43ccc528e04508c2`, ECS definition
`shorts-mvp-file-upload-production:14`, image
`sha256:357afd6f412720043d128a3e00dfffa1507e9ff3f55e95e6cb692df0f1d9b037`.
A bounded receiver patch must be built from that source and verified independently;
do not replace it with the entire current web worker tree. Follow
[file-upload-successor-runbook.md](file-upload-successor-runbook.md).

## Admission and behavior

- `MIDFORM_ENABLED=true` is off by default. `MIDFORM_RELEASE_ID` identifies the
  verified link worker; `MIDFORM_UPLOAD_RELEASE_ID` independently identifies the
  verified upload worker. Both must be verified before the home chooser appears.
- Each release has a private `midform_releases` record bound to an attested
  `editor_releases` row and immutable image/source/font identity. Do not mark
  verification passed on the strength of local unit tests.
- The upload release must additionally equal the existing upload admission
  resolver's exact receiver identity. The original upload feature flags stay intact.
- UI, API, SQL admission, submitter, and executing worker require administrator
  status. Existing project rendering resolves the project's pinned release, not
  the current new-job release. Old referenced definitions/images are retained.
- Link and file input both retain existing rights, billing, concurrency, cleanup,
  and retention controls. Inputs are 10–60 minutes; file input is bounded to 1 GB
  by this candidate UI. There is no requested output duration.
- One prompt picks complete interesting scenes, in source order. Silence is
  always aggressive (-30 dB, minimum 0.30 s, 0.08 s padding). No strength selector.
- Only the selected editing reel and final outputs are retained. Original media
  remains ephemeral and is cleaned up by the existing processing owner.
- Midform jobs/results are excluded from ordinary shorts lists, legacy editors,
  project archives/thumbnails, public examples and social publishing sources.
  Dedicated media access rechecks current administrator status and ownership.

## Required release sequence

1. Finish full static, regression and synthetic FFmpeg checks. Record any skipped
   environment-dependent tests explicitly; they are not passed release checks.
2. Build and attest link/editor and bounded upload receiver candidates. Preserve
   the fifteen isolated renderer checks, font manifest and versioned probe evidence.
3. Apply additive schema only after inspecting the actual existing admission guard.
   Repackage freshly retrieved submitter archives with exact source hashes; use
   revision-aware updates. Ordinary routing must remain unchanged.
4. Deploy a compatible unaliased web candidate, with new admission off. Retain
   all current publishing code and maintenance gates. Verify protected routes.
5. Complete the upload successor runbook, including actual nine acceptance checks
   and explicit drain/readiness evidence. Its admission fence affects new uploads;
   do not silently open that fence as part of an administrator-only UI test.
6. Test the actual candidate with an administrator: one permitted link, one file,
   render completion, reopen/edit/export/download, and usage/source cleanup.
   Verify an ordinary account cannot discover or invoke the feature.
7. Compare route manifests with current production, then promote the exact tested
   deployment without rebuilding. Restore temporary capacity to its agreed OFF state.

Local evidence is retained outside the release worktree under
`/private/tmp/easycut-midform-production-evidence-20261103/admin-midform-20261103/`.
It is not runtime attestation.

## Execution checkpoint (2026-11-03)

- Applied the additive midform migration and revision-checked submitter patches.
  New midform admission remains OFF; no midform runtime rows or jobs registered.
- Feature-OFF unaliased web candidate `dpl_8traqRYCjXkuussMTcCiwpxFvEkE`
  uses source `518c4640eb39191857357ca46bb7db63fd8509b6`. Authenticated Vercel
  fetches confirmed home, guidebook, pricing and editor responses; anonymous
  admin navigation redirects home, and `/api/midform` returns application 404.
- Production alias still points to the original baseline deployment above.
  No receiver successor fence, service switch or web promotion has occurred.
- Bounded upload source `6d58195dedd6a095707eaf2593d13dc0608ea633` passed the
  full CI repository gate in run `41497021140`. Its release configuration stage
  stopped because the new tag lacked a protection rule. Added exact-tag deletion
  and force-update protection (ruleset `26388002`), then dispatched run
  `41499731949` for the same source. Image attestation remains pending.
- The user authorized a short new-upload maintenance window. Begin it only once
  both runtime candidates and the acceptance-test configuration are ready.
