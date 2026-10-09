# Correct TikTok public release client — 2026-10-09

Baseline: production deployment dpl_5iAxnkGbVYv4gwLknrtFTfaNU8hW, commit 8c63b6db4f58e292d520032f89f43641b1030c4d. Same isolated worktree and branch; no lab resources.

## Verified root cause

The user supplied project 17592 and their account identifier. A scoped read of the 15:32:47 KST post found PUBLIC_TO_EVERYONE, failed, TIKTOK_UNAUDITED_CLIENT_CAN_ONLY_POST_TO_PRIVATE_ACCOUNTS, and no publish_id. TikTok did not accept this post.

Using Manage apps → EasyCut (app 7687459606926346258) → Production / Live, the portal shows Direct Post Approved and live since 2026-10-09 14:01 KST. Its public client identifier is aw0hf13lzubm6qu1. The failed connection's identifier does NOT match it. It DOES match Sandbox / EasyCut Review (7687493548878546962), whose public client identifier is sbawd0xc4kip84qf9e. Thus the prior launch activated the UI and approval flag while retaining Sandbox credentials. This is a configuration mismatch, not evidence of audit propagation delay.

The Production callback is https://www.easycut.co.kr/api/social/tiktok/oauth/callback. Production URL properties confirms https://www.easycut.co.kr/ as a verified URL prefix. No provider credential or token was exposed in this record.

## Prepared correction

Public mode must use the portal-verified Production client identifier; reject Sandbox, missing and unrelated identifiers. Change the unaudited-client message to explain the app configuration issue instead of telling users to make their accounts private. Preserve Sandbox records, encrypted tokens and their app binding; require a fresh user authorization for the Production app. Keep the token encryption key unchanged.

The user explicitly approved transferring the Production client key and secret to the existing Vercel production project on 2026-10-09. Browser login currently requires the user to complete Vercel two-factor authentication before applying the settings. Do not reveal credentials in tool outputs, source, CLI arguments, or release docs. Update only TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET in the verified Vercel shorts production project. Test a clean unaliased candidate, verify exact source and routes/admission, then promote the same candidate. Preserve YouTube maintenance and all unrelated settings. Real account connection and posting are reserved for the user.

Tests: 49 focused protocol/access/UI tests pass including rejecting Sandbox in public mode; lint and typecheck pass. No production correction has been deployed at the time of this note. Candidate build estimate under USD 3, no fixed resources. Rollback only to an appropriate verified configuration; the previous deployment still uses Sandbox and does not support public posts.
