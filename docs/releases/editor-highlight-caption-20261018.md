# Editor highlight caption compatibility — 2026-10-18

Production baseline: ccc43bc5cc317ce2d8f0c39887f1acd3f381045a,
Vercel dpl_E3A8h99w7pv3oeZZsTmqvbwBZsx8. Worktree editor-studio-release,
branch codex/editor-studio-production-20261018. Explicitly authorized production
fix; no lab resources, worker registrations, schema or environment changes.

A stored v4 5:4 highlight caption composition at (120,1333,840,140) extends
81px below the video. Existing pinned workers validate this composition even
with subtitles disabled. The apply-edit API already repairs other known 5:4
metadata boxes, but omitted this highlight variant.

Extend that existing normalization only for the exact built-in highlight box,
matching safeArea and absolute-position v4 contract. Its composition metadata
height becomes 59; actual safeArea, cues, timing, fonts, provenance, other layers
and stored source composition stay intact except for the same metadata repair.
Both clean-clip and extended source specs are patched atomically on the next
authorized save, retaining the original compare-and-set and every release guard.
No customer edits are retried or overwritten by deployment.

Verification: 167 web tests pass, including storage JSON serialization and
concurrent-change rejection; TypeScript and changed-file ESLint pass. Four
synthetic FFmpeg cases verify captions on/off, unchanged non-caption assets,
1080x1920 outputs, one-second duration and full decode. The new regression also
passes against exact production-pinned worker source
8c1412a17187c56488240ef8244e40e1a54dfade. Original metadata reproduces the error;
normalized metadata preserves byte-identical subtitle ASS output. Worker source
and Python dependencies are tested locally; this is not a replay of customer media.

Use the existing Vercel unaliased production candidate flow, compare actual route
outputs and test the five protected paths, then promote the same deployment.
Preserve publishing maintenance gates and all current routes. Bounded build and
local render estimate below KRW 5,000; no new recurring service or cloud render.
