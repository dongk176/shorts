# Overseas pricing visual parity — 2026-09-26

Target: authorized production UI correction. Baseline is the promoted source
`fdf863344b2a4e0e58fb26cf3d783206fe3c571f`, deployment
`dpl_CSVczptRgPHCh3pS6DWfPiawwnFj`, verified through Vercel's deployment API.
Worktree `.tmp/paddle-production-20260926`, branch
`codex/paddle-production-20260926`. The intervening commit contains release
notes only. Vercel project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw` uses the existing
production configuration (Supabase `mvcprswvfybudtopepuj`, `shorts_mvp`).
No DB, Paddle account/price, worker or environment changes are required.

The Paddle page omitted the shared `pricing-page` theme variables and wrapped
all pricing content in a section affected by global glass-panel styling. This
made the recommendation badge transparent, removed the primary CTA gradient,
and introduced a large outer card absent from Korean pricing.

Reuse the Korean pricing page class, hero and directly nested plan grid. Keep
current subscription information compact, distinguish next payment from period
end, use an opaque recommendation badge above the card border, and show the
12-month savings badge. Separate monthly-equivalent pricing from upfront totals.
Scope shorter card spacing and disabled/active CTA styles to Paddle cards;
Korean billing and all checkout/change behavior remain unchanged.

Local verification uses the built candidate, existing isolated Postgres
`127.0.0.1:55449/paddle_fullapp_local`, local authentication and sandbox config.
The named local fixture's display status is toggled for UI inspection only;
no provider subscription, payment, refund or webhook is invoked. Restore the
local fixture to canceled after inspection. The existing lab app is not used.
This proves rendering/layout and state labels, not new live payment behavior.

Browser checks cover EN/JP desktop, 390px and 320px mobile, 6/12-month badge
selection, active/canceled subscription labels, disabled current-plan buttons,
mobile Starter-first ordering and horizontal overflow. Candidate checks must
also cover the five protected paths, localized pricing and job admission before
promotion of that exact unaliased deployment. No payment tests are needed for
this presentation-only change.
