# Touch capture regression fix — 2026-09-27

- User reported physical mobile swipes did not change the center short despite previous mouse-drag checks.
- Production baseline `359a5a8983b9a88993183f922b43de8bed25db8f`; worktree `.tmp/showcase-geo-release-20260927`, branch `codex/showcase-geo-release-20260927`. Parent-only difference is the preceding release record.
- Touch implicitly captures the starting card. Explicitly capturing the fan emits a bubbling child `lostpointercapture`, which previously cleared the swipe ref. Ignore descendant capture-loss events; still cancel for the fan's own loss and pointercancel.
- React DOM regression tests model implicit capture transfer. Before fix: KO/EN/JA swipe cases all failed (center remained 1 instead of 2). After fix: all six cases pass, including vertical/diagonal movement without preventDefault or capture and explicit cancellation. Together with existing language tests: 20 passed. No physical-phone test claimed.
- Preserved `pan-y pinch-zoom`, swipe thresholds, normal selection and media loading. Mirrored handler fix into `.tmp/category-showcase-review-20260926` on 4123.
- Scoped lint and final local/remote builds passed. First local build caught a lint issue in the new test helper; corrected and rebuilt successfully. Candidate/live release checks: three locales, protected paths, route parity, locale routing, worker admission fingerprint. No worker jobs or DB/infra changes.
- Released source `d546a62a4e69c18d9392de40e04f7d662673b27f`; deployment `dpl_AzdGZQraspZPT4kYYMM7aJ6Y4taa`, https://shorts-n10dzmbfl-artiroom.vercel.app. Baseline rechecked before exact-candidate promotion.
- Initial 5-minute runtime error query: zero records. Evidence: `/tmp/showcase-touch-20260927/`. Existing-service builds/deployment only, no fixed-cost commitments.
