# New JPY subscription prices — 2026-10-21

Production baseline: da9f5fb8e97ae0617d93194b46572964c4a5cb19, deployment dpl_CqqCua7DMwd1kKqEG3jQ4jnV1K7v.
Worktree: .tmp/paddle-jpy-new-subs-20261021; branch codex/paddle-jpy-new-subs-20261021.
Target: explicitly authorized production price change. Existing live Paddle Vendor 427481, Vercel project prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw, Supabase mvcprswvfybudtopepuj/shorts_mvp. No lab resources used; lab is not a mirror of this release baseline. AWS configuration and worker revisions are not changed by this price-only release.

Monthly Pro: JPY 750. Starter totals for 3/6/12 months: JPY 6,870 / 11,340 / 17,880. Expert totals: JPY 16,470 / 29,940 / 47,880. Included tax, quantity one, no trial. Names, allowances and limits unchanged. USD and Korean prices unchanged.

The user chose discounts relative to the new 3-month monthly equivalent, replacing the discount percentages shown in the supplied image. Starter 6/12 month discounts are 17.4% / 34.9%; Expert 9.1% / 27.3%, floored to one decimal without overstating savings. Three-month plans display no discount.

New contracts use separate versioned plan codes and seven new provider price IDs. All legacy codes, IDs and amounts remain immutable. Existing subscribers retain their original catalog for renewals and plan management; cross-cohort plan changes are rejected. Canceled subscribers starting a new contract use the new catalog. Previously opened legacy checkouts can resume at their quoted price; fresh legacy JPY checkouts are rejected.

Only seven inactive internal plan definitions are added; no subscriptions are migrated and no public schema, data permissions, worker targets or publishing gates are changed. Public comparison and structured offer data use the new anonymous price. Authenticated legacy subscribers keep legacy prices in management.

Tests: local PGlite ledger verifies old and new JPY monthly initial payment and renewal at their respective immutable amounts and monthly allowance grants, existing payment/cancellation protections, idempotent migration and unchanged legacy rows. No test changes live customer subscriptions or initiates live charges. Actual candidate display/routes and server price configuration must be verified before promotion.

Cost estimate: one bounded remote web build plus existing read-only service checks, expected under USD 5; no new recurring resource or worker jobs.

Provider API read failed with missing price.read permission; prices were added and read back in the authenticated existing Paddle dashboard instead. Vercel CLI context verified production project; no complete production secret export was performed.
