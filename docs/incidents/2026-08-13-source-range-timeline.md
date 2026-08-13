# Source-range timeline incident — 2026-08-13

## Status

- Contained at 2026-08-13 12:15 KST by disabling the server-side
  `source_range_selection` switch.
- The reporting member's two affected projects were reimbursed for 540 seconds.
- Re-enable only after the release checks below pass on the immutable candidate.

## Impact

- Exposure window: 2026-08-05 19:26 KST through 2026-08-13 12:07 KST.
- 373 jobs used a non-zero selected-range start; 360 completed and consumed usage.
- 234 members and 249,540 seconds of usage are in the conservative remediation
  scope. All 360 completed jobs contain AI-selected clips; none are
  deterministic-only selections.
- 151 jobs across 108 members have selection timestamps that are provably
  outside the requested range after normalization. This is a strict lower
  bound, not the full impact, because an incorrect double offset can still land
  inside the requested range.

## Root cause

The transcriber persisted timestamps on the original-source timeline, including
the selected range's non-zero start offset. The highlight selector was given
that absolute transcript while its prompt and normalizer treated the same
timestamps as relative to a zero-based selected window. Extraction then added
the range start again. The selector's overlap and boundary recovery could move
an invalid candidate while retaining its original AI title, hiding the
timeline mismatch.

## Corrective changes

1. Persist the transcript and word timings on the absolute source timeline.
2. Derive a separate, clipped, zero-based transcript for highlight selection,
   legacy subtitles, edit timelines, and comment generation.
3. Add the selected-range offset exactly once, immediately before source media
   extraction and absolute word-timing lookup.
4. Reject out-of-range or overlapping AI candidates instead of moving their
   titles to unrelated footage; deterministic backfill titles come from the
   passage at the actual fallback position.
5. Fail closed before extraction if a clip or its raw selection is outside the
   requested absolute source window.

## Release checks

- Unit regression reproduces 09:28–14:57 selection and verifies that an AI
  00:00.160–00:25.080 clip extracts 09:28.160–09:53.080 exactly once.
- Double-offset and raw-selection-outside-window cases fail with
  `selection_range_mismatch`.
- Full worker test suite passes, including synthetic FFmpeg/ffprobe rendering.
- Immutable image scan reports no critical findings.
- The editor release workflow assumes the dedicated editor release build role,
  not the rolling worker deployment role.
- Run a production canary with a non-zero range start and compare requested,
  raw selection, extracted media, subtitle, and title timelines.
- Keep the feature switch off until the canary passes; on failure, retain the
  prior job definition and do not re-enable the switch.

## Customer remediation

Use the conservative 360-job scope for the reimbursement decision. The 151-job
strict lower bound must not be treated as the complete affected population.
Apply grants idempotently per job, account for any prior manual grant, and write
an administrator audit row for every reimbursement batch.
