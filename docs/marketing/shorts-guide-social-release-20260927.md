# Shorts guide social preview release

User requested a member group-chat announcement draft and production deployment of a feature-specific URL preview on 2026-09-27. No chat messages are sent.

- Target: authorized production web change, existing Vercel project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`.
- Source baseline verified against the promoted domain: `90481f61ee6a58e2e6e977c116fc1d1f4f19c758`, deployment `dpl_AtsX5PPGp7CPNWnUuLjvM35ehjcV`. Starting HEAD `4675ee0` differs only in release documentation.
- Worktree `.tmp/shorts-monetization-production-20260927`, branch `codex/shorts-monetization-production-20260927`. No lab services, database changes, worker changes or payments needed.
- Three static 1200×630 JPEG cards use existing brand artwork and fonts, with localized Korean/English/Japanese messaging. Per-page Open Graph and Twitter image overrides preserve other pages' default metadata. Article structured data uses the same localized image.
- Generator: `scripts/build-shorts-guide-social.mjs`; Japanese input is a static weight-700 subset instantiated from the existing NotoSansCJKjp variable font using fontTools, passed as `JA_FONT`. Generated images are committed; production does not need runtime image generation or font conversion.
- Validation scope: visually inspect all three cards; four metadata tests, scoped lint, full build, route-manifest comparison, existing release guards, candidate/live crawler metadata and exact asset hashes, protected paths and read-only worker admission fingerprint.
- Baseline manifest copied from the local build of the exact current production source before rebuilding. Evidence directory: `/tmp/shorts-guide-og-20260927/`.
- Deployment: clean committed source → unaliased production-configured candidate → verify → recheck live baseline → promote identical deployment without rebuilding.
- Bounded usage: local builds and one remote build plus read-only HTTP checks. No new recurring resources. KakaoTalk's app-side cached card is not directly verified by server metadata checks.
