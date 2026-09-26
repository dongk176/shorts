# Category showcase expansion — 2026-09-27

Local review only. No deployment. The user removed the six-month upload-date restriction.

## Completed

Added 11 language/category groups, 33 native-template Shorts. Together with the existing KO gaming and JA talk pilots, the page now has **13 of 18 groups, 39 Shorts with original audio**.

| Language | Completed categories and creators |
|---|---|
| Korean | Talk: KwakTube on official SBS Radio; entertainment: Pungja and Park Na-rae on TT STUDIO; education: Shuka on official SBS Radio; gaming: ChimChakMan |
| English | Talk: PewDiePie on Cold Ones Clips; education: John Green / vlogbrothers; gaming: MMG; vlog and entertainment: two different Tanner Fox originals |
| Japanese | Talk: Comdot Yamato with Haichi; education: Ryuji; entertainment and vlog: two official collaborations featuring Hajime |

Every group has comment-overlay, timed speech-highlight, and basic presentations. Added comments and reaction counts are explicitly AI demos. Titles are editorial copy, not speech transcripts. Individual sources, public counts, dates, license evidence and selected ranges are recorded in `curated-additions-sources-20260927.json`. Uploader subscriber counts must not be represented as a guest's main-channel count. Subscriber totals do not establish age demographics or universal recognition.

## Still incomplete: five groups

- KO reviews and vlogs
- EN reviews
- JA reviews and gaming

The KO vlog remains an explicitly marked old silent draft. The other four groups remain source-selection placeholders. The review footer reports the actual status of each category. None of these five is represented as finished.

Bounded official-channel searches included ITSub, MKBHD-related results, Linus Tech Tips, JerryRigEverything, iJustine, Techmoan, Technology Connections, HIKAKIN/HikakinGames and Ryuji reviews. No qualifying source was confirmed for these remaining slots. Negative search results do not prove that a whole channel has no CC videos. Unofficial reuploads were excluded. Public YouTube Data API requests later returned `429 rateLimitExceeded`; further API searches were stopped, while selected public browser results were checked directly.

Tanner Fox's MrBeast-event video `NRC8yV0dSig` has an official-channel CC BY label, but a suitable MrBeast-focused excerpt was not established. It was not used as a MrBeast showcase. The English entertainment example instead uses Tanner Fox's separate Orbeez original.

## Verification

- Source baseline: `f9750acf607b8116f5a032bd0322d886d3eac258`, with local uncommitted review changes on `codex/category-showcase-review-20260926`.
- Used the unchanged product `VideoRenderer.render_clean_clip`; no worker renderer modifications.
- Downloaded only bounded excerpts, not full source videos. No cloud, DB or production mutations.
- Corrected two Korean proper-name transcription errors and extended two excerpts to avoid clipping the closing words.
- Replaced ground-facing English vlog excerpts with face, view and vehicle scenes.
- Verified all 39 output hashes, 1080×1920 dimensions, audio streams and durations against their render records.
- Content-hash media URL versions prevent stale pre-correction video playback.
- Desktop browser: all four KO talk videos play; clicking a Short centers it; only the selected Short is audible; switching categories mutes audio.
- Mobile 390px: JA education's four videos play; document width equals viewport width, with no horizontal overflow.
- Scoped ESLint passed. Multilingual first-render suite: **12/12 passed**.
- Final local production build, including TypeScript checks, passed after all 13 groups were connected. Build log: `/tmp/easycut-curated-20260927/additions-final-build.log`.
- The pre-existing optional `linkedom/canvas` dependency warning remains. The build contains `/`, `/guidebook`, `/pricing`, `/admin`, and `/projects/[projectNumber]/edit/[shortId]`; no content-calendar route is present. No remote production comparison or promotion was performed.
- This is local verification, not a deployed production verification or deployment approval.

## Cost and provenance

Existing local compute and authorized transcription services only. Conservative estimated incremental transcription cost: below KRW 5,000; actual billing was not inspected. No new recurring resource was created. Each `*-curated.json` stores source range, actual render specification and output SHA-256. The source metadata file records the public reuse label, not a blanket clearance for unrelated uploads.
