# Showcase header and localized gallery follow-up

Requested after the initial showcase release: remove the small eyebrow and introductory description, enlarge category tabs, and fill the English/Japanese image rails with the actual category showcase renders in multiple templates.

Production baseline verified through the live Vercel alias: `737b4f35319894853bc760c11eae536a903cb07b`, deployment `dpl_AGhwxbTQ88ibXnJkYDEwbec9kM4r`, project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, owner `team_3pn55cGmUE8SRRKg0D3dRiPJ`. Continuing in `.tmp/showcase-geo-release-20260927` / `codex/showcase-geo-release-20260927`; its intervening commit is the previous release record only.

Category labels grow from 12px to 16px (mobile 11px to 15px), with larger padding and icons. Scrollable tabs safely align to the start when their contents exceed the viewport. Both auxiliary header lines are removed for all locales.

English and Japanese rails each reuse 18 already-rendered posters: six categories times comment overlay, highlight captions and basic templates. A cyclic starting offset preserves the deliberate style/subject alternation. Full 9:16 frames remain uncropped. Alternative text names the category/style/creator, and the credits list uses the six actual originals. The Korean image rail remains unchanged. No video renderer, new media, country-selection, DB, worker, infrastructure or environment changes.

Verification: localized first-render suite (12 tests), scoped ESLint, production build, route-manifest parity, remote protected routes and job-admission preflight, capture delivery checks, desktop/mobile browser checks. Use an unaliased candidate with existing production settings, verify before promoting that exact candidate, and recheck the live baseline immediately before promotion. Expected cost: one bounded build plus verification requests on existing services.

## Completed

- Deployed source `bafbaf55c51e6d4db798afe7d5edd0e9bfc08c39`; deployment `dpl_6e42Xhh4LEuvvZFiotowBxkcW411`, candidate `https://shorts-gqc7yspkd-artiroom.vercel.app`. Promoted this exact candidate to `https://www.easycut.co.kr` after verifying the unchanged baseline.
- All planned checks passed: 12 tests, scoped lint, both production builds, route parity, 17 remote page/locale checks, 72 videos, 36 gallery captures and the unchanged five-target admission fingerprint. Existing optional canvas warning remains non-blocking.
- Browser confirmed 18 distinct captures per EN/JA gallery, full-frame mixed templates, new descriptions, 16px desktop/15px mobile category labels and 390px viewport without horizontal page overflow. The last category remains reachable. Live English page confirmed the new gallery and removed header copy.
- The first post-promotion request briefly returned old header copy during alias propagation; a fresh full verification passed without changing or rebuilding the deployment. Immediate five-minute deployment error scan returned no entries.
- Detailed evidence remains in `/tmp/showcase-polish-20260927/{candidate,production}-verification.json` and `/tmp/showcase-polish-*.log`. This result record may have a later documentation-only SHA; the exact deployed source is the SHA above.
