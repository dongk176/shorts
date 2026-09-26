# Category showcase — local design review

Status: UI review draft, NOT release ready. User explicitly requested review before any deployment.

## Source and environment

- Production alias inspected read-only: `www.easycut.co.kr` → `dpl_7qTC5LBf1yDeiQonaVWHMnMqwgBm`, `shorts-nbabo5mn5-artiroom.vercel.app`, project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`.
- Matching release evidence in `docs/paddle/2026-09-26-pricing-final-polish.md` identifies released source `f9750acf607b8116f5a032bd0322d886d3eac258`.
- Isolated worktree `.tmp/category-showcase-review-20260926`, branch `codex/category-showcase-review-20260926`, created from that exact source.
- Local Next.js only, loopback `127.0.0.1:4123`. No production or lab credentials loaded. No database changes, jobs, cloud deployments, purchases or remote publication.
- Dependencies reused from the matching production worktree; test dependency linked separately. No shared package directory was modified.

## Implementation

Replaces only the original single-result TransformationShowcase. Preserves existing homepage input, navigation, project-list integration and lower gallery. Responsive dark section, six localized accessible category tabs, landscape source, three fanned portrait previews, template variation, muted playback, pause button and modal. Playback pauses when offscreen, page hidden or a modal is open. Reduced-motion preference disables automatic playback initially. Modal traps focus via native dialog, restores focus and stops background players. Current tab remains visible on narrow screens; arrow/Home/End keys select tabs.

`/showcase-review?locale=ko|en|ja` is a development-only review page; production returns notFound. Review navigation is not added to the product. The component itself is also connected to the existing homepage.

## Content limitations — do not promote this draft

This is a layout/template implementation, not completion of the requested new curated video library.

- Four retained existing source excerpts are connected: Korean vlog and gaming, English MMG gaming, Japanese Sugai/DenGan entertainment.
- Twelve MP4 previews are independently rendered using the unchanged production VideoRenderer and v4 editor render specs: dark-minimal, dark-red, white-yellow and paper. No HTML/CSS title, caption, comment, timestamp or player-control overlays remain inside the videos. Korean samples use clean 3–15s source windows (three 4-second outputs); English/Japanese use three 5-second windows. Both Korean landscape samples are trimmed to remove the baked-in player controls at their beginnings. Original video captions remain. Renderer provenance, exact specs, source intervals, output hashes and dimensions are recorded in category-rendered-v2.json.
- Excerpts are silent. Expanded playback does not restore unavailable audio.
- Four of eighteen locale/category combinations have preview media. Fourteen show explicit pending states with disabled video controls, rather than mislabeled unrelated footage.
- Titles and colored emphasis are encoded by real templates. No fabricated comments or engagement counts. All source and output players hide controls, including the expanded modal; pause and close controls remain outside the video.
- Poster JPGs were extracted from retained media; no full YouTube source was downloaded or stored.
- New source selection/reuse checks, full authored clips, audio, attributions (including Korean originals) and content quality review are still required before production.
- Final content must replace draft notices, source selections, short preview windows. Remove the local review route from the release or retain its production 404 guard.

## Validation

- TypeScript and scoped ESLint passed with the matched dependency setup.
- Production build passed. Existing optional `linkedom/canvas` warning remains; no change to that dependency. No deployment performed.
- 39 i18n first-render/config/routing regression tests passed. Updated the existing localized-media test to verify four video elements, six tabs and no cross-locale media leaks.
- Browser: Korean/English/Japanese review pages; real video readyState=4, muted autoplay, three distinct rendered files; pause all; modal keeps template style and pauses all background players; close restores keyboard focus; pending tab state; arrow-key selection.
- Japanese 390px and English 320px visually inspected. No horizontal document overflow. Fixed narrow language-control wrapping and selected-tab visibility.
- Existing homepage renders its navigation, input and replaced section in local mode. Its data-backed initial state reports `home_initial_state_failed` because no DB connection was loaded. Live project lists, login and generation were not verified, and are unchanged.
- Browser console on the isolated review page had no errors. Logs: `/tmp/easycut-category-review/{tests-final,build-final}.log`.

## Review URLs

- `http://127.0.0.1:4123/showcase-review`
- `http://127.0.0.1:4123/showcase-review?locale=en`
- `http://127.0.0.1:4123/showcase-review?locale=ja`
- Existing homepage placement: `http://127.0.0.1:4123/#category-showcase`

## 2026-09-27 video-only revision validation

- 12 outputs passed FFprobe checks: H.264, yuv420p, 1080×1920, expected 4/5-second duration. Local render script removes intermediate files on completion. No renderer source changes.
- Scoped ESLint, TypeScript, 12 first-render regressions and production build pass for this revision. Build retains the existing optional linkedom/canvas warning. Logs: /tmp/easycut-category-review/{tests-v2,typecheck-v2,build-v2}.log.
- Browser Korean vlog/gaming, English gaming and Japanese entertainment: all four videos readyState 4; all native controls false. Expanded output uses its rendered MP4 and pauses all four background videos. Pause-all verified. English 390px mobile has no horizontal overflow; viewport restored. Review browser console has no errors.
- Tests cover the local uncommitted candidate on the production baseline listed above, without cloud credentials or backend verification. No deployment.

## 2026-09-27 structurally different template revision

User correction: the three examples must differ in composition, not just color. Every populated group now uses this fixed order:
1. Comment capture: native comment-capture renderer, header + landscape video + comment card. Comment text explicitly starts with AI demo/AI 예시/AI例 because the native renderer blurs the nickname. The shown reaction count (10) is a template example, not real engagement.
2. Highlight captions: native v4 highlight caption renderer, no header/channel, full-height blurred-video background preserving the landscape subject, large timed yellow word emphasis. The silent source has no transcript; text is authored editorial copy, not an assertion of spoken words. The Korean vlog emphasis sample crops its existing bottom caption strip before composition.
3. Basic: dark-minimal native renderer with header and uncropped landscape footage; no added comment or highlight-caption layer.

All 12 previews use distinct source intervals and actual encoded MP4 output. No in-video HTML overlays or controls were reintroduced. The base worker renderer and its safety validations remain unchanged. Local-only; no deployment, cloud work or backend changes.

Scoped TypeScript, ESLint and 12 first-render tests passed after the data/component update. The production build passed before this media/copy revision; it was not rerun for this revision. Output specs, hashes and caption/comment provenance are in category-rendered-v4.json.

Final browser verification: Korean and Japanese source + 3 outputs all readyState 4, playing, controls false. English locale resolves all three v4 output URLs with loaded metadata and no media errors at inspection. Japanese emphasis modal plays the encoded caption output while all background videos pause. Screenshot confirms distinct comment, full-height emphasis and basic compositions. All 12 final MP4s passed duration/codec/dimension assertions during rendering.

## User-facing copy and arrow revision

Removed the central EasyCut mark and restored the production-style standalone gradient arrow. Replaced retained-source placeholder titles/descriptions in source metadata with localized benefit-focused copy, preserving original metadata in source credits. Expanded players now explain the selected comment/highlight/basic style; source modals use the category headline. Removed technical sample copy from the component footer; the development-only review notice still records silent/demo provenance. Source caption typography is larger. No media or renderer changes. TypeScript, scoped ESLint and 12 first-render tests pass. Desktop gaming view and expanded highlight copy visually verified; 390×844 modal fits with no horizontal overflow. No deployment.

## Spacing, casual copy and inline selection revision

User feedback supersedes the earlier marketing tone: localized headings and descriptions now use conversational wording. Desktop/tablet grid gaps and fan padding reserve space for the rotated cards; desktop measured arrow-to-card bounding-box gap 24px. Source metadata and modal copy no longer use the rejected formal copy.

Short clicks now select the center card inline instead of opening a modal. Stable media keys preserve video elements/playback while the three positions animate over 600ms; the other two cards move to the sides. Native buttons expose selected state and support keyboard activation. Category changes reset to the emphasis sample in the center. Reduced-motion preference disables position transitions. Source-video expansion remains available.

TypeScript, scoped ESLint and 12 localized first-render regressions pass. Browser verifies all three selections, no short dialog, visible 600ms movement, 900px layout without horizontal overflow, and 390px mobile carousel with arrow above and separate from the cards. Local only; no deployment.

## Selection affordance and type-size follow-up

Removed the 16:9 badge and footer note/pause control at user request. Source heading/description increased to 24/16px (20/15px mobile). Template labels are now accessible toggle buttons synchronized with the inline center-card selection; selected label has a lavender fill and dark text, and the selected video has a lavender outline. Clicking either the label or video centers the same card. Verified both directions in desktop/mobile browser, no horizontal overflow. TypeScript, scoped ESLint and 12 first-render tests pass. Local only, not deployed.

## Gradient styling revision

Removed final sentence periods from showcase copy (source captions, heading and modal descriptions); source metadata/URLs are unchanged. A shared coral–lavender–periwinkle gradient now styles heading emphasis, source label/headline, selected category border, selected template text/border and the selected video frame. The prior solid purple frame and filled lavender pill were replaced with a thin masked gradient frame and dark gradient-tinted buttons. Template labels retain synchronized 600ms carousel movement. Desktop screenshot and 390px DOM inspection verify readable text, actual gradient styles and no horizontal overflow. Scoped ESLint and 12 first-render tests pass. No deployment.

### Background seam correction (2026-09-27)
- Removed the showcase's opaque base and inherited home glass-panel backdrop blur. Kept the existing page background visible through the section.
- Softened the coral/lavender glow to transparent at every outer edge, including an explicit horizontal fade, so it does not end at a rectangular panel boundary.
- Verified visually on the local Korean review page and the local homepage at `/#category-showcase`; the homepage computes a transparent section background and no backdrop filter, with no horizontal overflow at the desktop viewport.
- `git diff --check` passed. CSS-only change; no deployment or backend verification performed.
