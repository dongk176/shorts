# Updates archive production release — 2026-09-30

Authorized by the user after reviewing the final local design. Scope: updates list/detail pages, 28 editorial entries, 19 current product screenshots, navigation, canonical metadata and sitemap. Preserve the reviewed dark UI, large typography, centered gradient heading and unboxed featured item.

Observed production baseline: 72203bc7b1ee86ede4deaa12f3053b914f42b29b, deployment dpl_tjN4NvyQd46UraUBeSRziBepRypJ, shorts-bnfjnc0qt-artiroom.vercel.app. Confirmed from the www.easycut.co.kr alias and live deployment metadata. This worktree is already based on that exact commit.

Production project: prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw, team_3pn55cGmUE8SRRKg0D3dRiPJ. Project root web, Next.js. Existing production account configuration remains separate from the source baseline. No DB schema/data writes, worker/configuration changes, paid fixed resources or actual generation/upload tests are part of this release. Lab has a separate source/configuration and is not the test target.

Plan: local web lint/typecheck/build and existing release guard tests; compare baseline/candidate route manifests, permitting only /updates and /updates/[slug] additions; one unaliased production-configured candidate; verify five protected paths, all update articles, assets and admission fingerprint, then promote that exact deployment without rebuilding. Check the production alias again before promotion.

Estimate: one hosted web build and bounded read-only checks, below USD 2 in existing metered services; no recurring commitment. Full deployment metadata and evidence live in /tmp/updates-release during execution.

Date provenance remains explicit: code history dates may differ from rollout dates; September 30 captures show current screens. No claim that these are historical screenshots.

Preflight results: web ESLint passed; 11 existing release/candidate guard tests passed; live project-link identity matched. The historical production-baseline.json points to ff091cf7 and its worker checksum is stale even in the currently promoted source. The historical baseline command failed on that existing checksum; no guard or manifest was weakened. All three worker/target/baseline manifests are byte-identical to live production commit 72203bc7. Current release verification uses the live deployment identity, exact parent commit, unchanged worker/configuration files, route parity and live candidate admission fingerprint.
