# 2026-11-22 editor failure investigation

## Verified boundaries

AWS CLI STS confirmed production account 181651591905 in ap-northeast-2.
Production database: mvcprswvfybudtopepuj / shorts_mvp.
Worktree: .tmp/service-recovery-20261122, branch codex/service-recovery-20261122,
existing HEAD b6fe1f744d7b2fde7f8ba0d6dd722d447e222a6b retained.
Vercel production hostname resolved to dpl_C4zob5U1kADUV2BWAVZyNEvnzRGm,
source 2d1577892713631e98ac0a9f79519afe494bc501, an ancestor of this worktree.
Initial diagnosis was read-only. Subsequent authorized release preparation is recorded below.

## Submitted failures

Actual Batch job definition for all six inspected jobs:
`shorts-mvp-editor-release-ce70d54685be-4vcpu:1`.
Its log configuration specifies `/shorts-mvp/production/worker`; logs were read
using each job's actual container logStreamName, not a guessed stream.
Image digest: sha256:38dd00e495cd2abde5dcd5692e14b4c3e2a0f9bfb033c0fb554a831f9028599d.

| Project | Batch job | Result | First exception |
| --- | --- | --- | --- |
| 38481 | 95117a52-66bd-42f2-8305-546fabc303f3 | exit 1 | editor_renderer.py:1908 RenderError: 편집 타임라인 길이가 저장된 문서와 일치하지 않습니다. |
| 38481 control | 0248a10b-cf86-4fdd-82e3-db5dcc47cde6 | exit 0 | none |
| 38210 | b4442c3a-bd5f-49b3-a202-df8075841766 | exit 1 | same timeline RenderError |
| 38356 | 29475065-8f33-4d88-b8d6-e5a65009500d | exit 1 | same timeline RenderError |
| 37517 | 849128a4-4346-442a-82cb-b308d4b832ff | exit 1 | caption_templates.py:1531 CaptionCompileError: 편집 자막을 다시 배치하지 못했습니다. |
| 37517 | acd956ff-bd19-4def-adc6-4789e00a0d00 | exit 1 | same caption exception |

38481 has six succeeded requests and one failed request; failed completion is
2026-11-22 13:00:22 KST. All requests use editor release
1fe6420f-833c-40f7-aece-1d04e7a7ce94. The generic Batch statusReason appears even
on the successful control, so is not a cause. Collected logs contain no FFmpeg
error or OOM termination evidence. Exceptions are Python application failures.

ffprobe of the stored edit timeline objects (not full source videos):

| Project | DB expected seconds | Actual container seconds |
| --- | ---: | ---: |
| 38210 | 82.000 | 81.033333 |
| 38356 | 67.230 | 66.291667 |
| 38481 failed | 76.570 | 75.780000 |
| 38481 success | 118.370 | 118.433333 |
| 37517 | 132.000 | 132.065399 |

The three timeline exceptions occur before layer composition; background images
and template text are not the failing operation. The caption exceptions are
inside retime_editor_caption_spec -> reflow_caption_cues_for_clips ->
rebuild_caption_cue_text. The failed edit snapshots are no longer retained in
pending_edit_snapshot, so the exact customer text that triggered empty rebuilt
cues is not recovered. Do not claim a particular punctuation input was confirmed.

## Existing fixes and regression verification

This worktree already includes timeline metadata tolerance (da47b0bf), bounded
end padding, and caption editing fixes (98eee661). The production editor image
is still ce70d546; web source presence does not update this pinned worker.
No duplicate behavior patch was added. Added the three measured tail deficits
to the existing synthetic FFmpeg/ffprobe regression test.

- Extracted the exact deployed ce70 extract_sequence function via AST and ran
  the same six synthetic cases: 1 passed, 5 failed. All three new incident cases
  reproduced the same RenderError.
- Current worktree: six extraction cases passed, with audio/video lengths checked.
- Full test_editor_renderer.py + test_caption_templates.py: 194 passed.
- custom-template-design.test.ts: 50 passed.
- Ruff for modified regression test: passed.

These are local source tests, not verification of a newly deployed image.

## Separate pre-submission gate

`assertCustomTemplateDesignRenderRelease` emits the reported Korean message
with CUSTOM_TEMPLATE_DESIGN_RENDER_UNAVAILABLE before dispatch when immutable
render evidence is absent or not recognized. Existing recovery commit 30946c4c
recognizes two explicitly pinned japanese-quality-prompt-only releases while
retaining source/digest/font/probe/frame checks.

Read-only DB verification of releases 3c559307-a495-4082-9ac8-d5d9147452b9 and
221b1fcd-9b06-499d-97e9-d2093db2a4e3 confirmed verified_at, exact probe matching,
rendererAndDocumentSchemaUnchanged, allFreshFrameHashesEqual, and 69 frames.
The promoted web commit predates this recovery patch. This explains rejection
for these releases; the customer's unidentified blocked request has not been
correlated to one of them. Do not conflate this admission issue with the five
submitted failures above.

## Release status

Production web/worker NOT PROMOTED. Existing recovery changes preserved. User initially prohibited
browser/screen use and later authorized incognito login only. User subsequently authorized isolated browser release validation and Docker restart.
Do not promote an unverified worker or falsify parity/canary evidence. Next work
requires exact-image validation, existing release registration/canary procedure,
and verification of the unaliased production web candidate and protected routes
before promoting the same deployment. Keep existing referenced worker targets.

## Release preparation follow-up

Full make verify passed on 2026-11-22 after correcting three stale release-test
expectations against live AWS/DB identities. Web: 4,578 passed / 183 skipped;
infra: 43 passed. Docker-dependent SQL checks are rerun separately after an
authorized Docker restart. New immutable candidate tag is
editor-v4-render-parity-20261122-1; old protected tags remain untouched.
Candidate metadata tests: 41 passed. This does not imply cloud registration
or production promotion has completed.

## Candidate verification follow-up

Docker recovered after the authorized restart. Isolated schema tests passed
47 + 79 = 126 checks. Candidate 64e79054 web deployment
dpl_7gb99fkgrGE5uQoZC2Yh4QQZEWd4 is READY and unaliased. Source route comparison
against promoted 2d157789 has no removed/added routes. Authenticated browser
verification passed home, guidebook, pricing, admin and editor entry; save/render
verification remains pending the exact worker.

Stage B renewal for tag 20261122-1 completed and verified its live template;
production queues, worker definitions and stable pointers remain unchanged.
Cloud workflow 44994663733 stopped in make verify because infra tests still
referenced the prior exact release tag. Corrected those test fixtures together
with all exact bindings for a new immutable 20261122-2 tag. The failed tag is
retained unchanged. Infra tests now pass 43/43; renderer/app source is unchanged
from 64e79054. New cloud run must pass the full gate before image registration.

Cloud run 44995728134 passed full make verify, image scan, isolated SQL
contracts, AWS probe bba92f4e-3b19-4259-82b7-eebfc47a96e9 (exit 0) and
69/69 browser parity cases (DOM max 1.533px, pixels max 2px). Registered
canary-ready f48a9a2b-17bc-4db7-af99-f49cfb14edb6, source 43fd7590,
digest sha256:b2391bed81ca493e2a99db8c1798aaae2400ce7fc4fd7e7475786a2c5300c4d2.
All 15 isolated checks passed. Same image run locally with network disabled
also passed all 3 incident tail deficits; audio 9.000s, video 9.033333s on a
9s synthetic selection. No customer failed job replay. Production promotion
remains pending exact successor handoff and administrator canary checks.
