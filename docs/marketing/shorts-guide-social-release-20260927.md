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

## Verified production result

- Deployed source `22cb3bfd62187674798797e4623eece967500325`; deployment `dpl_HuGnp3G2qzQ7Wf1ee35so1qBxaJ1`; candidate `https://shorts-lhif6xa8z-artiroom.vercel.app`. Live domain confirms the identical deployment and READY state after promotion.
- Local and remote production builds passed. Four metadata tests, eight release guard tests and scoped ESLint passed. Exact baseline/candidate manifests both contain 249 routes, with no additions or removals.
- Candidate and production each passed nine grouped read-only checks: all three localized OG/Twitter images, canonical and language metadata, translated alt text, article image, image MIME/dimensions and exact SHA-256; homepage default image; five protected route responses; five worker target fingerprints.
- Home, guidebook and pricing returned 200. Admin retained its sign-in redirect. The nonexistent editor fixture retained its existing 404; the actual editor route is present in both manifests, but authenticated editing was not exercised by this metadata-only release.
- Candidate access used a temporary deployment share link without changing protection settings. No analytics events, DB mutations, payments or worker submissions were performed.
- Live source was rechecked before promotion and remained the approved baseline. The immediate preceding ten-minute error-level runtime log query returned zero records. This is bounded verification, not ongoing monitoring.
- All three cards were visually inspected. KakaoTalk app-side cached previews were not directly checked or cleared. Subsequent documentation-only commits do not alter the deployed source above.

## Centered typography revision

User requested the homepage's simpler centered-text composition. Verified current production remains `22cb3bfd62187674798797e4623eece967500325` / `dpl_HuGnp3G2qzQ7Wf1ee35so1qBxaJ1`. This is the release baseline; subsequent local changes before this revision are documentation only.

- Replaced the card-and-button layout with a centered two-line headline, small guide label and subtitle on a dark background. Korean, English and Japanese use the same layout; all three were visually inspected.
- New `-v2.jpg` asset URLs avoid overwriting previously shared image files. Existing files remain available for cached links.
- Existing production project/configuration; no database, worker, billing or infrastructure changes. Bounded one local and one remote build with read-only candidate/live checks.
- Baseline manifest and verification evidence: `/tmp/shorts-guide-og-simple-20260927/`. The same clean-source, protected-route, candidate-before-promotion release process applies.

Centered revision deployed: source `d0c390fc897890062916129d53cecaaf7b902f28`, deployment `dpl_J6dzJTDnnnmUQ8Pw2ha7JGpNmn2Q`, candidate `https://shorts-4fl8dovy1-artiroom.vercel.app`. Local/remote builds, four metadata tests, scoped lint and exact baseline route guard passed. Candidate and final production each passed nine grouped checks from the previous release, including exact hashes of all three new images and unchanged worker admission fingerprints. The first immediate post-promotion request briefly returned previous metadata; a bounded retry after propagation passed on all three unchanged production URLs. Vercel confirms the exact candidate is promoted and READY. Immediate ten-minute error log query returned zero records. KakaoTalk app cache remains outside direct verification. This documentation-only commit does not alter the deployed source.
