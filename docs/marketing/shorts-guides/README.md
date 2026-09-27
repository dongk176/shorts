# Personalized strategy and paid workbook collection

Local implementation, 2026-09-27. No deployment, remote data writes, or payment attempts.

## Tested source and environment
- Worktree: `.tmp/shorts-monetization-production-20260927`.
- Branch: `codex/shorts-monetization-production-20260927`.
- Base: `add473bedd3b34140b204199e148e7eac3cafbc6`, previously matched to the production release. Current changes remain local and uncommitted.
- Dev server: `http://127.0.0.1:3018`, clean process environment without application credentials or DB/worker services.

## Product behavior
- Eight questions: topic, monetization goal, channel stage, footage, filming style, available time, preparation readiness, and current obstacle.
- Readiness question adapts to the monetization route. Changing goal/topic clears the dependent readiness answer.
- Results include route/preparation priority, obstacle-specific action and measurement, three topic-based outlines, EasyCut workflow, time/stage advice, five contextual FAQs, and the weekly plan.
- Unverified footage takes priority over monetization advice. Missing products prompt demand discovery; missing sponsorship samples prompt portfolio preparation.
- Copy includes the personalized additions and the localized page URL.
- Recommended book moves to the first position after quiz completion. Contents and one sample page are public. Full PDFs are private.
- New collection is included with an active paid plan, separate from the existing package-only ebook collection. Expired/free accounts do not receive files. Paid-through cancellation remains eligible until the end of the active period.
- Entitlement uses the existing billing summary and internal app user ID, resolved without creating or updating sessions. Download endpoint independently rechecks authenticated billing. Invalid IDs/locales fail before filesystem access; errors fail closed; responses are private/no-store.
- Pricing pages, including the Paddle presentation, explain the same benefit without altering payment behavior.
- Korean `/shorts-monetization`, English `/en/shorts-monetization`, Japanese `/jp/shorts-monetization`; login return URLs preserve locale and library anchor.

## Books and authoring
Five original workbooks, each 13 pages, in Korean, English and Japanese (15 PDFs / 195 pages): first-short, affiliate, series, brand, sales.
- Private deployment assets: `web/private/shorts-guides/{ko,en,ja}/*.pdf`.
- Review/download artifacts: `output/pdf/shorts-guides/{ko,en,ja}/*.pdf`.
- Public assets contain covers and page-3 JPEG samples only.
- Unique chapter prose, practical examples and tasks: `chapters.tsv`.
- Catalog and exercises export: `node scripts/export-shorts-guide-data.cjs`.
- Build: `python3 scripts/build-shorts-guides.py` with reportlab, pypdf and fonttools, plus pdftoppm.
- Noto Sans KR/JP are instantiated at 400/600 and embedded; existing repository font license notices apply. Font cache is generated under `tmp/pdfs/`, not a deployed asset.
- PDFs contain EasyCut practice, a storyboard, time-based schedules, a worksheet, FAQ and official reference links. Examples are original practice scenarios, not fabricated income claims. PDFs are static workbooks with writing space, not interactive forms.

## Verification
- 101 tests across 10 files passed: strategy/model, localized routing/middleware, access, internal billing identity mapping, download API, and existing pricing layout/guest behavior.
- TypeScript and scoped ESLint passed.
- Browser: all three locales override conflicting cookies; 8-step quiz, copied localized plan, recommended book, public sample, localized pricing and login return, language picker with query/anchor, metadata/sitemap all passed. No runtime errors.
- 320/390/768/1440px viewport checks showed no horizontal overflow, before and after completion; photo card heights remain consistent.
- Browser verified all cover images load and the benefit is present on each localized pricing page.
- Guest API downloads return 401; direct private file URLs return 404. Authenticated paid/free/expired/error behavior is covered by mocked local tests, not real payment-account verification.
- PDF parser confirms 13 pages each; builder asserts paragraph bounds; all final pages rendered with Poppler and all 15 contact sheets visually reviewed for legibility, clipping and layout.
- Full production build attempted but failed with `ENOSPC` (local disk full). Removed only this worktree's newly generated production build cache. Full build/file-trace verification remains outstanding; no release readiness claim.
- Before any future production promotion: re-check current production baseline, build the exact candidate with sufficient disk, verify private PDF file tracing and authenticated paid downloads, and follow the existing protected-route/candidate release checks.

## Editorial redesign, 2026-09-27
- Replaced the text-only cover with five distinct full-bleed photographic covers, a shared issue-number system, and localized display headlines.
- Redesigned all 13 pages with photo openings, a three-step diagram, dark EasyCut workflow, three-frame storyboard, side-by-side schedules, and a spacious worksheet. Chapter prose and practical tasks remain intact.
- Real Pexels photography only; source links and photographers are in `assets/SOURCES.md` and each PDF. Photos are illustrative, not claimed customer outcomes.
- Regenerated all 15 PDFs (195 pages). `editorial-qa.json` records matching private/review copies, SHA-256 hashes, and final file sizes (1.2-3.1 MB each).
- All 195 final pages rendered with PDFium and reviewed as contact sheets; enlarged cover, chapter, and longer-text samples checked. Poppler renders the public previews at 840px / 1260px wide. No full PDFs are in the public preview directory.
- Verified the updated cover and expanded sample in Korean, English, and Japanese at a 390px mobile viewport; Korean desktop also checked. Preview URLs use the new editorial cache version.
- This pass changed document generation, artwork, public sample JPEGs, and the preview cache version only. Paid-download authentication and entitlement logic were not changed. Production deployment and authenticated paid-account verification remain outstanding.
