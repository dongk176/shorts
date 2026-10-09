# TikTok connection failure feedback — 2026-10-09

## Baseline and target

Production-read-only diagnosis verified the current alias points to deployment `dpl_Ckr4qu9Y6kXHiCUdZGjxpFvxnewA`, source `3ff35b5a106b4d87f446f93b64948ee737f2e655`. Work continues in its clean isolated worktree `.tmp/tiktok-public-20261009`, branch `codex/tiktok-public-20261009`. The user authorized fixing the failure feedback as part of the public launch. Production Vercel project remains `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`. No DB schema/configuration change, lab work, or real TikTok authorization/post is required.

The affected login had no saved TikTok connection. Its historical OAuth error cannot be recovered: the previous callback caught and discarded all failure details, and the page showed one generic sentence. No cause is asserted without evidence. Automatic review rejected an initially unscoped DB query and an unconfirmed project tab read; neither was bypassed. A later user-specified email allowed an exact account-scoped, credential-free connection-state query.

## Change

Preserve allowlisted error codes from the authorization exchange, permission validation, creator lookup and connection save. Expired or mismatched OAuth requests return to a safe app page without using the untrusted return path. Callback failures carry a generated reference and fixed error code; provider descriptions, credentials, OAuth state and account IDs never enter the URL or diagnostic log. Logs contain the operation stage and reference for the next attempt. A small SQLSTATE allowlist helps identify database failures without logging raw exceptions.

The UI shows a prominent accessible alert with a specific reason and recovery guidance for existing-account conflicts, missing permissions, expiry, app configuration, network/provider failures and posting limits. Unknown failures explicitly remain unknown. OAuth failures with unconfirmed revocation show a separate cleanup notice. Arbitrary callback query text is not reflected, and error parameters are removed after display. Network or malformed responses normalize to known UI errors instead of being used as invalid translation keys.

No changes to account ownership, consent, permission requirements, posting retry rules, YouTube maintenance, media access or entitlement. The test suite verifies that failed connections do not create a post or reassign another user's connection.

## Verification and release

Run TikTok protocol/SQL, handler, UI, access/media and shared dialog tests; frontend lint and typecheck. Build a clean committed production candidate without aliasing, verify protected routes, job admission, API fail-closed behavior, and compare hosted route outputs to the baseline. Promote that exact candidate only if the baseline alias has not changed. Verify actual alert rendering with a simulated failure return URL, explicitly not a real OAuth attempt. The user performs real account authorization and posting.

Ordinary estimate: under USD 3 for one hosted build and bounded read-only checks; no fixed resources or worker jobs. Rollback is promotion of the baseline deployment, with no DB rollback required.
