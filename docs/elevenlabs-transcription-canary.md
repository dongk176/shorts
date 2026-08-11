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

## Public privacy and provider approval gate

`elevenlabs_transcription_public` must remain `false` until every item below has
dated evidence and the Korean privacy notice has been approved. Do not copy the
OpenAI retention language to ElevenLabs: the providers have different defaults.

- Provider and role: identify `Eleven Labs Inc.` (`legal@elevenlabs.io`) as the
  transcription processor. ElevenLabs' self-serve DPA applies to business
  customer content and requires the customer to give data subjects the notices
  and obtain the consents required by applicable law.
- Purpose and fields: disclose that selected-source audio chunks are sent over
  TLS to Scribe for speech-to-text, language detection, and word-level timing,
  and that ElevenLabs returns transcript text, language information, and word
  timestamps. Do not list account email, source URL, or full project metadata
  unless a later implementation actually sends them.
- Transfer location: the current worker uses the standard
  `https://api.elevenlabs.io` endpoint. ElevenLabs documents the standard
  environment as U.S.-hosted/stored; its public policy also identifies server
  locations in the United States, the Netherlands, and Singapore, while the DPA
  permits affiliates and subprocessors to process elsewhere. Obtain and retain
  the current Trust Center subprocessor/country list before approving the exact
  Korean international-transfer row. Do not claim Seoul or Korea residency.
- Retention: the current request omits `enable_logging=false`, so default history
  preservation is enabled. For self-serve services, the DPA says ElevenLabs may,
  but is not required to, delete customer content after 180 days of inactivity;
  this is not a 180-day maximum. A deleted database item is removed immediately,
  deleted data may remain in backups for up to 30 days, and
  debugging/moderation logs may remain. Therefore, `30 days` or `180 days` is not
  a truthful total retention period. Either obtain a contractual maximum,
  implement and verify deletion of each transcript/history item, or disclose the
  provider's retention criterion and deletion behavior.
- Zero Retention Mode: it is an Enterprise-only feature and is active for
  speech-to-text only when `enable_logging=false` is sent and the account is
  eligible. Verify in request history that no item is created before claiming
  zero retention. The present worker must not make that claim.
- Model improvement: ElevenLabs documents that non-Enterprise accounts may use
  submitted data to improve models by default and that the account owner can
  disable **Terms and privacy > Data use > Improve the models for everyone**.
  Record dated dashboard evidence that this is disabled, or contractually
  confirm Enterprise no-training treatment, before retaining Easy Cut's current
  promise that user content is not shared for provider training.
- Minors: ElevenLabs' public privacy policy says users must not submit Voice Data
  from children under 18. Its prohibited-use policy also restricts bundled
  services for people under 18. Obtain written provider/legal confirmation for
  third-party voices in source videos or implement an enforceable input policy;
  Easy Cut's current under-14 account rule alone does not resolve this.
- User terms: update the AI-processing clause to name ElevenLabs as primary
  transcription and OpenAI as per-chunk fallback. The content-rights warranty
  must cover the notices, permissions, and consents needed to send every audible
  person's data to these processors.
- Effective notice: update the Korean, English, and Japanese privacy/terms copy
  together and follow the product's advance-notice process for a material
  provider and international-transfer change. Do not silently change only the
  Korean rendering.

Official references checked on 2026-08-11:

- ElevenLabs DPA (last updated 2026-04-08):
  <https://elevenlabs.io/ko/dpa>
- ElevenLabs privacy policy (last updated 2025-12-03):
  <https://elevenlabs.io/privacy-policy>
- Speech-to-text API (`enable_logging` defaults to `true`; ZRM is Enterprise):
  <https://elevenlabs.io/docs/api-reference/speech-to-text/convert>
- Zero Retention Mode and backup behavior:
  <https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode>
- Data residency (standard U.S. environment; isolated residency is Enterprise):
  <https://elevenlabs.io/docs/overview/administration/data-residency>
- Model-improvement opt-out:
  <https://help.elevenlabs.io/hc/en-us/articles/29952728805393-Is-my-data-used-to-improve-ElevenLabs-AI-models>
- Prohibited Use Policy:
  <https://elevenlabs.io/use-policy>

### Korean disclosure draft (not approved for production)

Use this only after the unresolved country, training, retention, and minor-audio
items above have dated evidence. Bracketed text is a release blocker, not copy
that may appear in the product.

| 항목 | 고지 초안 |
| --- | --- |
| 수탁자·연락처 | Eleven Labs Inc. · `legal@elevenlabs.io` |
| 위탁 업무·목적 | 작업 영상 오디오의 음성-텍스트 전사, 언어 감지 및 단어별 타임스탬프 생성; 서비스 제공, 보안·오남용 방지 및 장애 대응 |
| 이전 항목 | 선택한 원본 구간에서 추출한 오디오 청크와 그 안의 음성 내용, 전사 텍스트, 언어 정보 및 단어별 타임스탬프 |
| 이전 시기·방법 | 이용자가 쇼츠 생성 작업을 제출한 때 TLS로 암호화된 API 통신을 통해 수시 이전 |
| 이전 국가 | 미국(기본 환경의 저장·처리), 네덜란드·싱가포르 등 공급자 공개 인프라 및 **[Trust Center에서 확인한 정확한 재위탁 처리국을 기재]** |
| 보유·이용 기간 | 현재 기본 보관 모드: 처리 목적과 계약 이행에 필요한 기간. 셀프서비스의 경우 180일 미사용 후 공급자가 삭제할 수 있으나 삭제 의무나 최대기간은 아님. 요청 기록 삭제 시 데이터베이스에서 즉시 삭제되나 백업은 최대 30일 남을 수 있고, 디버깅·콘텐츠 조정 기록은 공급자 정책 또는 법령에 따라 추가 보유될 수 있음. **[계약상 고정기간 또는 자동 삭제 검증이 있으면 실제 값으로 교체]** |
| 거부 방법·효과 | 쇼츠 생성 작업을 제출하지 않는 방법으로 이전을 거부할 수 있으나, AI 기반 쇼츠 생성 기능을 제공할 수 없음 |

Required Korean AI-processing meaning:

> 작업 영상의 오디오는 ElevenLabs Scribe API로 우선 전사하며, 실패한
> 오디오 청크는 OpenAI API로 대체 전사할 수 있습니다. 전사 텍스트와
> 영상·클립 메타데이터는 하이라이트·제목·합성 댓글 생성에 사용됩니다.
> 각 공급자에 전송되는 항목, 국가, 목적, 보유기간과 거부 방법은
> 개인정보처리방침의 국외이전 항목을 따릅니다.

Required content-rights meaning for the user terms:

> 이용자는 원본에 포함된 음성 등 개인정보를 서비스 제공에 필요한 AI
> 처리업체에 전송·처리하도록 할 수 있는 적법한 권한을 보유하고, 관련
> 법령상 필요한 고지와 동의를 완료해야 합니다.

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
