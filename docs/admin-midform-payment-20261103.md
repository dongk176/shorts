# Administrator midform integration after payment release

Production baseline: `3197c28fd9b8ef6c969f2d2f60d34f2d69004a29`, observed
on `www.easycut.co.kr` at deployment `dpl_Ewvc4ujv18xigwK8tQCJ8wVZief2`.
This includes the released PayPal one-time checkout, reconciliation, payment
notifications, refund and administrator integration. All payment source files
remain unchanged by the midform merge.

Integrate the previously tested administrator-only midform source
`524dfc2054db2f4e056739e912305674d6dc6b63` from the shared production ancestor
`2ba44dde771b965e7cf2febc16fe27555cf640a4`. The earlier standalone midform
deployment must never be promoted. Use this integrated source for a new,
unaliased production candidate and promote that exact tested deployment.

Production account configuration is independent of the code baseline: Vercel
`prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw` / team `artiroom`, Supabase
`mvcprswvfybudtopepuj` / `shorts_mvp`, AWS `181651591905` / `ap-northeast-2`.
Retain the existing additive midform schema and attested private release
`c569fca5-e8f9-4925-81fe-f9bdf8677454`. Do not deploy the full Compute stack.
The shared upload receiver remains on revision 14 until the existing successor
drain, readiness, nine actual checks and atomic promotion procedure completes.

Verification covers the integrated payment regressions, protected route manifest,
ordinary generation admission, administrator-only discovery and access, link and
file generation, speaker transcript editing, saved edits and rendered output.
Retain existing payment/publishing configuration and normal worker routing.
Record any unverified area explicitly. User-facing midform remains an
administrator test feature; automatic scene joins may need editorial adjustment.

Budget estimate: up to USD 15 for bounded existing-service builds and two short
generation/re-render checks. Reuse the earlier same-image 1/5 GiB receiver
evidence only while its original observations are fresh and all required runtime
identities match. Restore temporary idle capacity after testing. No new fixed
recurring service is introduced.

Evidence: `/Users/gimdongmin/shorts-clean/output/admin-midform-payment-20261103/`.
