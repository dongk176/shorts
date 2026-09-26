# Showcase header and localized gallery follow-up

Requested after the initial showcase release: remove the small eyebrow and introductory description, enlarge category tabs, and fill the English/Japanese image rails with the actual category showcase renders in multiple templates.

Production baseline verified through the live Vercel alias: `737b4f35319894853bc760c11eae536a903cb07b`, deployment `dpl_AGhwxbTQ88ibXnJkYDEwbec9kM4r`, project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, owner `team_3pn55cGmUE8SRRKg0D3dRiPJ`. Continuing in `.tmp/showcase-geo-release-20260927` / `codex/showcase-geo-release-20260927`; its intervening commit is the previous release record only.

Category labels grow from 12px to 16px (mobile 11px to 15px), with larger padding and icons. Scrollable tabs safely align to the start when their contents exceed the viewport. Both auxiliary header lines are removed for all locales.

English and Japanese rails each reuse 18 already-rendered posters: six categories times comment overlay, highlight captions and basic templates. A cyclic starting offset preserves the deliberate style/subject alternation. Full 9:16 frames remain uncropped. Alternative text names the category/style/creator, and the credits list uses the six actual originals. The Korean image rail remains unchanged. No video renderer, new media, country-selection, DB, worker, infrastructure or environment changes.

Verification: localized first-render suite (12 tests), scoped ESLint, production build, route-manifest parity, remote protected routes and job-admission preflight, capture delivery checks, desktop/mobile browser checks. Use an unaliased candidate with existing production settings, verify before promoting that exact candidate, and recheck the live baseline immediately before promotion. Expected cost: one bounded build plus verification requests on existing services.
