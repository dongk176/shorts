# TikTok public Direct Post release — 2026-10-09

## Authorized scope and baseline

The user supplied the Direct Post audit approval email for EasyCut app `7687459606926346258` and requested all remaining launch work, reserving actual account posting tests for themselves. No real OAuth authorization, upload, publication or deletion is part of this verification.

Production was independently verified through the Vercel canonical alias and API: project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`, deployment `dpl_zSLXtm9RqHXprhGYPAmDSdjZxcST`, commit `5811f62f2d021f9e988a4cdb83d845364eab58c2`. Isolated worktree `.tmp/tiktok-public-20261009`, branch `codex/tiktok-public-20261009`. Production DB `mvcprswvfybudtopepuj` / `shorts_mvp` was verified using the connected Supabase service; the official media origin is verified and the prior constraint allowed only SELF_ONLY. Lab resources are not involved.

## Change

Introduce explicit `TIKTOK_PUBLISHING_MODE=public` plus `TIKTOK_DIRECT_POST_AUDIT_APPROVED=true` while preserving exact production project, DB and canonical-origin checks. Local and admin-review modes remain private-only. Active account checks and existing paid publishing entitlement apply to members; administrators keep demonstration access. Connection management remains accessible when a plan expires. No grant to site administration or other platforms is introduced.

The project receives a separate server-derived TikTok availability flag. Members with publishing entitlement open TikTok directly; YouTube retains maintenance and other platforms retain their placeholders. OAuth return restores the appropriate TikTok panel. Public audience choices come from fresh creator information, without preselection. Consent, media ownership, retention, account restrictions, commercial disclosure and duplicate suppression remain enforced. History and result dialogs display the saved audience. Retry after an explicit unaudited-client rejection records the newly chosen audience.

The database migration only expands `shorts_mvp.tiktok_posts_privacy_check` to TikTok's four supported values. It preserves existing rows, ownership, RLS, privileges, triggers and all other schemas. Apply after local SQL integration verification; a five-second lock timeout bounds lock contention. The previous release remains compatible with the expanded constraint.

## Verification and release procedure

Focused tests cover public/admin-review configuration, paid access and withdrawal, cross-user denial, OAuth fencing, consent, current creator limits, public requests, rejected-post retry, duplicate avoidance, media capability expiry, disconnect/withdrawal and the shared upload dialog. Test providers are simulated; they do not prove real TikTok account posting.

Use a clean committed source, hosted Linux production build at an unaliased URL, compare the full route manifest/output paths with the current production baseline, verify protected pages and job-admission fingerprint, and test unauthenticated TikTok endpoints fail closed. Promote the exact tested deployment after rechecking the canonical alias. Keep existing credentials and all unrelated settings unchanged. Persist only the two non-secret TikTok release flags.

Ordinary usage estimate: one hosted candidate build plus bounded read-only requests, approximately under USD 3; up to two rebuilds if required by verification. No new fixed-cost resource, Batch job, media generation or actual TikTok post.

Production secret export was rejected by automatic review. It was not executed or bypassed; project/variable metadata and the connected database tool were used instead. No secret was copied into this worktree.

Rollback: promote baseline deployment above. Expanded privacy constraint may remain to preserve any public history; do not narrow it or delete public posts. Revert public mode to admin-review for future builds if rolling back the feature.
