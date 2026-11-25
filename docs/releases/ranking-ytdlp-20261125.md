# Ranking yt-dlp recovery — November 25, 2026

Production baseline: `43085f4c05a05c33838ecb71299b8404d053cc7f`.
Production project: `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw` (artiroom).

Only the ranking dependency snapshot and its reproducible installer change.
The ranking Python payload, web routes, generation workers, publishing gates,
payment configuration and database schema remain identical to the baseline.

- Previous snapshot: `snap_oPJ18yU5RpDAiNHC4wJePDz3c1SQ`.
- Candidate snapshot: `snap_4rJo1ef9OvW7crEAYDWnaqvdbizl`.
- yt-dlp: `2026.7.4` → `2026.11.23`.
- Unchanged: yt-dlp-ejs `0.8.0`, bgutil provider `1.3.1`, Pillow `11.3.0`.
- The candidate was cloned from the existing clean dependency snapshot, changed
  only yt-dlp without dependency upgrades, and snapshotted before adding any
  proxy credentials, customer data or test media. Snapshot expiration is disabled
  to avoid breaking later production session creation. Preserve both snapshots.

The same public video and exclusively locked, idle ISP endpoint were tested in
old/new/old/new order: old failed both metadata probes with format_unavailable;
new succeeded both, returning public availability and five formats. Direct
non-proxy probes had failed bot checks for both versions and were not proof of
version causality.

Release gates: fresh session from the exact candidate snapshot, actual public
video import and ranking render, full FFmpeg output decode, ranking regression
checks including synthetic rendering, unaliased production candidate, route
manifest parity and protected-path checks, then promotion of that exact build.
Only `RANKING_VERCEL_SNAPSHOT_ID` is changed in the release configuration.
Existing customer sessions retain their original snapshot until their ordinary
30-minute lifetime expires; do not stop active customer sandboxes.

Rollback: promote the previous production deployment
`dpl_esQtyFThH1Pdom2fPmM3hiDzu9qc` and restore the previous snapshot configuration
for future builds. This does not roll back the already-promoted AWS workers.
