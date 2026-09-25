# YouTube audit remediation

Production baseline: c7d3d314e3e807770da8ddc9e4241e9c64443d74,
deployment dpl_3GHgysqddoWnA7j5Vv5wKdcuU19W. This isolated branch preserves
the already deployed reviewer-only upload flow. No lab or worker release.

Targets: Vercel prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw, Supabase
mvcprswvfybudtopepuj / shorts_mvp. Public metadata uses dofarming-502005;
the owner confirmed that project serves EasyCut exclusively. Upload OAuth uses
easycut-youtube-prod-260803; isolated testing used easycut-youtube-test-260803;
Google login uses easy-cut-502316. Disclose these separately to the reviewer.

## Changes

- Put the YouTube terms agreement, Google privacy policy and Google revocation
  links at the top of the terms/privacy pages, with Korean, English and Japanese
  explanations and concrete in-app/email deletion instructions.
- Replace the hand-drawn publishing icon with the unmodified official PNG.
  Preserve its transparent clear space and intrinsic aspect ratio. A 48px-high
  asset contains a 25.85px-high visible mark, above the audit's 20dp minimum.
- Add independent timestamps for public YouTube display metadata in project
  records. Refresh at 25 days, expire stale display fields at 29 days. Update
  title, channel name and both thumbnail URLs; do not alter uploaded-file
  metadata, user-submitted URLs, generated outputs or usage/billing values.
  API errors retain cache only before its retention deadline. Valid missing or
  non-public video results clear provider display data. All background API
  requests use the existing dofarming quota reservation.
- The authenticated cron maintenance option performs one bounded 50-row
  refresh using deployed credentials, without early expiry during the initial
  refresh pass. The normal scheduled URL always enforces expiry.

## Observed retention gap and rollout

Read-only production audits found 38,012 expired popular snapshots, 76,582
expired search snapshots, and old provider display metadata in project rows.
The catalogue itself had zero expired non-null metadata. Legacy cleanup was
explicitly false; existing migration readiness returned ready=true, all five
blocking counts zero, and 32 pending metadata placeholders. All old snapshots
had corresponding catalogue and discovery-history records. Do not delete the
catalogue, calendar history, projects, generated outputs or billing records.

The additive migration was applied transactionally to the verified production
schema. Existing rows have NULL verification dates until an actual successful
refresh; adding a column never resets their age. No existing rows were deleted
by the migration.

Before promotion: refresh old project metadata through the unaliased candidate,
validate retention and preservation, enable the existing guarded legacy-cleanup
setting, and run its readiness-gated cleanup. Compare protected routes and
job-admission fingerprint against production. Promote that exact deployment.

Local verification: initial make verify passed script/worker checks but stopped
on a stale privacy effective-date assertion. The assertion was updated with the
new policy date; full web suite then passed (3,040 tests, 139 skipped). Dedicated
embedded-Postgres tests cover metadata expiry, failed/malformed API responses,
transaction rollback, upload isolation, accounting preservation and channel
thumbnail refresh. Infra tests passed (36); infrastructure synthesis passed.
Actual deployment and final remote evidence are recorded separately. Do not
claim YouTube approval or all violations resolved before that verification.
