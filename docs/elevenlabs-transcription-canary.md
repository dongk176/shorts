# ElevenLabs transcription canary

This release keeps every existing job on the current OpenAI worker until all
three admission conditions are true. The policy is selected once, in the same
transaction that creates the job, and every retry keeps the stored policy and
immutable AWS Batch target.

## Admission states

| Master environment | `elevenlabs_transcription` | `elevenlabs_transcription_public` | New jobs |
| --- | --- | --- | --- |
| off | any | any | everyone uses `openai_stable` |
| on | off | any | everyone uses `openai_stable` |
| on | on | off | admins use the candidate; everyone else uses `openai_stable` |
| on | on | on | all new jobs use the verified candidate |

Do not enable the public flag until the provider disclosure and privacy text
have been approved. Turning a flag off affects only new jobs. Existing jobs
finish on the Job Definition digest stored when they were created.

## Safe deployment order

1. Apply `202608060001_elevenlabs_transcription_canary.sql`; verify both flags
   are false.
2. Add `ELEVENLABS_API_KEY` to the existing worker runtime secret. Never add it
   to the web client or logs.
3. Build the worker image once, scan it, and record its immutable digest.
4. Deploy only `ShortsMvpElevenLabsTranscription-production` with
   `includeElevenLabsTranscription=true` and the recorded digest.
5. Add the exact candidate Job Definition and queue ARNs to the web environment
   and to the Batch submitter Lambda. Do not deploy the full compute stack to
   make this runtime-only Lambda environment change.
6. Deploy the web candidate with `ELEVENLABS_TRANSCRIPTION_ENABLED=false` and
   verify the protected routes plus stable job routing.
7. Promote the same verified deployment without rebuilding it.
8. Set the master environment to true, then enable only
   `elevenlabs_transcription`. Keep `elevenlabs_transcription_public=false`.
9. Run Korean, English, Japanese and mixed-language admin fixtures. Confirm
   word timestamps, language detection, fallback counts and rendered clips.

## Required canary checks

- A normal member job stores `openai_stable` and the existing stable target.
- An admin job stores `elevenlabs_primary_openai_fallback` and the exact
  candidate target.
- ElevenLabs success stores real word timestamps in `job_transcripts`.
- A failed 30-second chunk alone uses `whisper-1`; successful chunks are not
  repeated and the final provider is recorded as `mixed`.
- No API key, transcript text, source URL or user PII appears in provider logs.
- Retry and resume use the original candidate ARN and never drift to stable or
  source-range definitions.
- Stable job success rate and queue latency do not change during the canary.

## Rollback

First set `elevenlabs_transcription=false`. If required, also set the master
environment to false. Do not delete the additive columns or transcript table.
Do not terminate healthy jobs already pinned to the candidate. If the web has a
separate regression, promote the previous verified Vercel deployment without
rebuilding it. Stable OpenAI jobs and their worker definition remain untouched.
