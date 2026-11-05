# Paddle new subscription prices and unpaid checkout recovery

Production baseline: f54a2ea39a9906cc1d2702f3cfb5180a30b05f24, deployment dpl_EtZ4gCHQ6LA2JkL1XhDc876LZZ9W.
Isolated worktree: .tmp/paddle-restore-20261105, branch codex/paddle-restore-20261105.
Production targets: Vercel prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw; Supabase mvcprswvfybudtopepuj / shorts_mvp. No lab or worker changes.

New contract cohort v20261105 preserves all legacy provider prices and subscriptions. USD totals: Pro 12/month, Starter 87/144/228 for 3/6/12 months, Expert 207/354/588. JPY: Pro 1900/month, Starter 12900/17940/34900, Expert 30900/52900/87900. JPY Starter 6m monthly equivalent 2990 is the default recommendation; 12m remains slightly cheaper per month. Package totals renew at their selected interval. Tax included, quantity 1, no trial. Provider IDs are public identifiers, gated to live environment; local sandbox requires explicit test IDs.

Read-only audit and authorized cleanup: 29 stale Paddle ready checkouts were independently retrieved from Paddle, confirmed draft/ready without a subscription or authorized/captured payment, canceled, and verified. Paddle webhooks reconciled all 29; DB now has 62 canceled and 39 completed. No completed payment changed. Four uncharged PayPal one-time ready orders do not block Paddle, and 20 PayPal subscription attempts are canceled. Three paid PayPal entitlements remain intact.

Two existing Paddle subscriptions remain paused at the provider with expired billing periods. These are actual contracts, not unpaid checkout artifacts; not canceled or reset. They remain protected against duplicate subscriptions.

Checkout retry now verifies a same-plan provider transaction before reuse. Canceled provider checkout can be replaced even before webhook delivery; paid/processing/unknown outcomes stay protected. Local real-SQL tests apply the additive plan migration twice and verify new-cohort grants, duplicate webhook handling, legacy renewal prices, and cross-provider safeguards. 168 payment tests passed, 3 environment-dependent tests skipped. No live customer charge performed.
