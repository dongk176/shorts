# Editor reliability release — 2026-10-14

Production baseline: `fd14ce965e336d67b3bd7e3ed70e5c13bfc1875e`
(Vercel `dpl_FHoe5cmygThRYxo1XY8WVPUv7Cjy`). Branch:
`codex/editor-reliability-20261014`. Existing lab work is excluded.

Fixes:
- CJK additional text/channel/subtitle controls retain only full CJK font faces;
  old selections normalize in the editor, and stale unsupported save requests fail
  before enqueue. Existing saved documents remain readable.
- SNS submitter accepts exactly the registered dedicated `4fbfeeaa` editor release,
  SHA, image digest and revision, retaining account and compatibility attestation.
  Package only the inspected editor Lambda function, preserving all other archive
  members and configuration. Do not redeploy the general control plane.
- Known v4 5:4 legacy caption metadata is intersected with video geometry; absolute
  safeArea, cue coordinates, text, fonts and other layer geometry remain unchanged.
- Save canonicalizes source clocks for pinned older workers, recompiling timed
  layers again on one concurrent version retry. DB capture guard protects already
  deployed generation workers while a clean-clip edit is rendering. It leaves
  completion transitions and existing captured media untouched.
- Invisible-only visible titles are rejected before rendering.
- Fractional output lengths use a conservative millisecond duration so both JS
  and Python accept timed overlays.

Verification: focused web regressions, actual FFmpeg synthetic rendering (including
legacy 5:4 with captions on/off), Lambda allow/deny tests, local PostgreSQL trigger
and SNS DB guards, typecheck/lint/build. Full web suite has baseline failures in
SNS test provider setup, administrator query snapshots and TikTok requestId
expectations; separate them from this release's regressions. Evidence and final
counts are in ignored `.local-review/` alongside candidate route comparison and
HTTP checks. A public HTTP check alone does not prove authenticated editor saving.

Production dependencies: Supabase `mvcprswvfybudtopepuj` / `shorts_mvp`, AWS
`181651591905` / `ap-northeast-2`, Vercel `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`.
No new fixed infrastructure. Bounded build/render checks use existing runtimes;
estimate under KRW 5,000, no AI calls or customer video replays planned.

Deployment: apply only the added capture-guard migration, update editor submitter
code using its inspected RevisionId, then verify an unaliased production web
candidate and promote that exact deployment. Keep the old Lambda ZIP and prior
Vercel deployment for rollback; the DB guard is backward-compatible. Existing
customer outputs and failed edit requests are not rewritten or automatically retried.
