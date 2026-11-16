# Ranking media reuse and public showcase delivery

Production baseline: `534eb0b56249a638a8ad4172747d59ffbd49854d`, deployment
`dpl_DmBPCXtnrEhamcFeu1rDPvcQKFzC`. The English shorts comment task's November 16
SNS admission migration (`20261116015115`) remains applied independently. This
web-only change neither applies migrations nor promotes its unfinished candidates.

Visited ranking source editors now retain their video and filmstrip frames while
switching ranks, including closing/reopening the mobile scene dialog. Unvisited
editors stay lazy; removed/replaced sources unmount. Inactive sources pause. The
selected-frame preview also retains its source video rather than remounting for
every rank. Browser-managed buffers are used; no full-file blob cache or change
to signed media authorization, encoding, rendering, quality, or layout is introduced.

All 44 currently displayed KO/EN/JA ranking examples (including the introduction)
use immutable content-addressed URLs on existing public CloudFront distribution
`E3NYPMMRTFR2KF` / `d1mzwx29nljvyq.cloudfront.net`, backed by `artiroom-uploader`
in production account `181651591905`. They total 530,176,491 bytes. Both S3 HEAD
checks and full CDN downloads match the original SHA-256 values. Byte-range
requests return 206. Original public files remain for older clients; posters are
unchanged. No infrastructure, bucket policies, or fixed capacity were created.

Reproduce transfer comparisons with `scripts/benchmark-ranking-rank-transfer.mjs`
and playback boundary checks with `scripts/verify-ranking-source-playback.mjs`.
Both use the real editor, synthetic video, mocked APIs, and a local no-store range
server. `PLAYWRIGHT_MODULE_PATH` points to an installed playwright-core module;
`BENCHMARK_MOBILE=1` enables mobile, `BENCHMARK_INPUT=upload` tests local files.
They do not access customer media. Server-flushed body bytes measure canceled
requests accurately; values depend on buffering/timing. Rank switching dropped
to zero new requests/bytes in repeated desktop/mobile comparisons. Trimming still
fetches newly sought ranges as needed. These are controlled scenario results,
not a measured percentage reduction in monthly bills or customer traffic.

Evidence and logs are in `.tmp/release/ranking-media-reuse/` (untracked).
