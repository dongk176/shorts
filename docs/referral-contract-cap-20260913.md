# Referral contract caps — 2026-09-13

Production source baseline: `2e1e5e6858f7ebe6cee147aff6b9ea8f16f2cbe6`.
Worktree: `referral-contract-cap-20260913`, branch `codex/referral-contract-cap-20260913`.
Target: authorized production referral-only correction. Customer payment, refund policy, entitlements and cash transfers are outside this change.

## Contract

Capture each approved order’s original product, duration, actual amount, rate, approval date and evidence. Toss billing cadence remains unchanged. Renewals capture their own contract. Unknown original duration or conflicting/incomplete conversion evidence holds the partner’s settlement and prevents preparation, including requests from the previous web deployment.

Recognition uses the lesser of actual retained revenue and the sum of retained original installments. Allocate from the first installment, capped at the original installment amount, preserving cumulative floor rounding, KST calendar months, seven-day availability and the following month’s tenth-day payout. A higher conversion price cannot spill into closed installments. Preserve installment IDs and cash snapshots; existing refund debt offsets future settlements once and carries forward.

## Verification

- `make verify`: passed scripts, worker tests, web tests/typecheck/build and CDK tests/synth. Web: 2,748 passed, 102 conditional skips. Script tests: 204 passed. CDK tests: 36 passed. Existing conditional worker skips remain.
- Final targeted PostgreSQL trigger, service, policy and settlement suite: 49 passed, including conflicting conversion metadata. Local PostgreSQL 16 only; no lab verification claimed.
- Anonymous production snapshot: 154 commissions, zero payouts. Actual migrations plus backfill reproduce 154 rows locally, zero amount mismatches, two explicit holds. Repeating reconciliation changes zero rows.
- Hold reasons: one missing original 12-to-6 conversion record, one uncompleted 6-to-1 difference refund. Neither customer refund nor subscription is changed to resolve these holds.

## Rollout

Use only migration `202609130003_referral_contract_caps.sql`, then `scripts/referral-contract-reconciliation.mjs` snapshot/preview/apply. Apply requires the exact source snapshot hash and tested implementation hash, locks affected ledgers, checks for draft/paid payouts and compares every resulting contract and partner/month total before committing. Any drift rolls back. Before/after state and evidence are retained in referral audit logs. Snapshot/report files contain anonymized identifiers and whitelisted evidence only.

Deploy a clean commit to an unaliased production candidate. Compare the complete route manifest with the baseline and verify protected paths and all five registered worker identities before promoting that exact candidate. Runtime evidence and final reconciliation reports are stored in the task’s output directory.
