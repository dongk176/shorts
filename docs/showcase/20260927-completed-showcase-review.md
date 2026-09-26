# Completed local showcase review — 2026-09-27

Target: local review only. No cloud, database, environment configuration, or production mutation; no deployment.
Worktree: `.tmp/category-showcase-review-20260926`, branch `codex/category-showcase-review-20260926`, baseline `f9750acf607b8116f5a032bd0322d886d3eac258`, plus uncommitted local showcase changes.

## Result

All 18 language/category groups are connected: KO, EN and JA, each with talk, entertainment, review, education, gaming and vlog. Each has a landscape original preview and three distinct native-template Shorts (comment overlay, speech highlight, basic), totaling 54 audio-bearing Shorts. No category uses the old silent draft or a preparation placeholder.

Category descriptions are centralized in `web/lib/category-showcase.ts`; both the showroom and original preview dialog use category copy instead of creator-specific promotional sentences. Creator names and original titles remain in attribution.

All 18 highlight Shorts were rendered using the exact home default `SUBTITLE_TEMPLATE_BRAND_COLOR` (#35E6E3). Caption center moved from 1530 to 1205 on normal 1920px portraits, 1140 for the specially cropped JA talk layout, and 1538 for KO gaming's stacked face/game layout (previously 1690). Original embedded captions remain part of the source. The worker renderer was not modified; the local preparation script passes the native caption specification.

## Added sources

- KO reviews: 침착맨 플러스 food review collection, `Y-zhzOKvzVA`
- KO vlog: official 버드모이 collaboration featuring 원지, `rCZr6Uv_yW4`
- EN reviews: Tanner Fox's Model X tour, `id1D3Ud5-2Q` (10 million uploader subscribers; about 1.2 million views at verification)
- JA reviews: スタンミ's food review, `qQ8zNDzgFV0`
- JA gaming: official ありさか gameplay with HIKAKIN participating by voice, `AjD5LTBeLxU`

Individual public CC BY labels were verified and recorded in `curated-additions-sources-20260927.json`. Guest recognition is distinct from the uploader's subscriber count. HIKAKIN is a voice participant, not an on-camera subject. The KO vlog uploader has about 135,000 subscribers; this is not Wonji's main-channel count. No MrBeast-specific example is claimed.

The KO review original is a 4h20 compilation. Only three short manual excerpts within its first two minutes were downloaded for this local showcase; the product's stable 3–60 minute ingestion gate was not changed or tested against that full video. These edited examples demonstrate the native templates, not an automatic full-source ingestion run. Full sources were not stored in S3 or downloaded. CC metadata documents the uploader's reuse label, not blanket clearance of unrelated third-party material.

## Verification

- 54/54 MP4 hashes match provenance; each is 1080×1920 H264 with audio and the recorded duration
- All 18 highlight render specs use #35E6E3
- New outputs inspected via contact sheets and actual poster frames; Korean review ending trimmed before an incomplete next phrase
- All 18 browser category tabs show four correct media URLs and category-specific copy, with no preparation placeholders
- KO desktop and JA review mobile video elements reached readyState 4; mobile 390px has no horizontal overflow
- Clicking a Short centers it without opening a dialog; sound control unmutes only the selected Short
- Scoped ESLint passed; multilingual first-render tests 12/12 passed
- Final production-mode local build and TypeScript checks passed; optional pre-existing linkedom/canvas warning remains
- No worker renderer code changed; existing synthetic FFmpeg/ffprobe integration tests retained
- Review route remains development-only via notFound outside development

Verification artifacts: `/tmp/easycut-curated-20260927/completed-media-verification.json`, `/tmp/easycut-curated-20260927/completed-build.log`. Media URLs include output content hashes to prevent stale video playback.

## Cost

Used existing local compute and bounded authorized transcription calls for five new short excerpts. Conservative incremental transcription estimate below KRW 5,000; billing not independently inspected. No recurring resource created.

This supersedes the earlier 13/18 status in `20260927-category-expansion-review.md`. User review is still required before any deployment.
