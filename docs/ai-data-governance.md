# AI data governance

Last reviewed: 2026-07-26

This runbook keeps Easy Cut's public AI and international-transfer disclosures
aligned with the worker's actual data flow. Review it before changing an AI
provider, model, endpoint, billing project, retention control, or prompt logging
setting.

## Production data flow

1. The prepare worker extracts audio into task-scoped ephemeral storage.
2. Audio is split into short chunks and sent to OpenAI's audio transcription
   endpoint. The worker deletes the local source, chunks, and intermediate
   transcript in `finally` cleanup.
3. Transcript text and video metadata are sent to Gemini only when both
   `GEMINI_API_KEY` is present and
   `GEMINI_PAID_DATA_PROCESSING_CONFIRMED=true`.
4. If paid Gemini processing is not confirmed, unavailable, or unsuccessful,
   the worker sends the text request to OpenAI Chat Completions.
5. The comment-capture template uses the same paid-Gemini-first,
   OpenAI-fallback rule. Its comments are synthetic copy, not collected social
   media comments.

The worker does not use face recognition, speaker biometric identification,
fine-tuning, provider feedback sharing, grounding, provider File APIs, or
provider-hosted conversation state.

## Provider gates

### Google Gemini API

Keep `GEMINI_PAID_DATA_PROCESSING_CONFIRMED=false` unless an operator has
verified all of the following on the exact Google Cloud project associated with
the production API key:

- Cloud Billing is active and Google classifies API use as a Paid Service.
- Prompt/response logging has not been opted into a shared dataset or feedback
  workflow.
- No unpaid project key is present in the worker runtime secret.
- Current terms still state that paid-service prompts and responses are not
  used to improve Google products.
- The public privacy policy reflects the current abuse-monitoring retention
  period and processing locations.

Google's current paid-service terms and retention controls:

- <https://ai.google.dev/gemini-api/terms>
- <https://ai.google.dev/gemini-api/docs/usage-policies>
- <https://ai.google.dev/gemini-api/docs/zdr>

If any check is uncertain, leave the confirmation flag false. The worker must
continue through the required OpenAI fallback.

### OpenAI API

- Do not opt the production organization or project into sharing API inputs,
  outputs, evaluations, or feedback for model improvement.
- Use stateless audio transcription and Chat Completions only. Do not add
  Assistants, Threads, Files, Batches, or stored Responses without first
  updating retention controls and public notices.
- Review whether the organization qualifies for Modified Abuse Monitoring or
  Zero Data Retention. Do not claim those controls are active until verified in
  the production project.

OpenAI's current API data controls:

- <https://developers.openai.com/api/docs/guides/your-data>
- <https://openai.com/policies/sub-processor-list/>

## User-facing controls

- `/privacy#international-transfers` lists recipient/contact, country, fields,
  timing and method, purpose, retention, refusal method, and refusal effect.
- The job submission screen displays the AI providers, input types, provider
  retention periods, and a link to the detailed transfer disclosure before the
  user starts a job.
- Google Analytics must not load before the optional analytics-transfer consent
  is accepted. Rejection must not limit normal service use.
- The terms identify synthetic comments and require human review before
  publication.

## Change checklist

Before deploying a provider or data-flow change:

- Trace every user-content field sent to the provider.
- Confirm the legal entity, privacy contact, processing countries,
  subprocessors, retention, training use, and deletion controls from primary
  provider documentation.
- Update the Korean privacy policy and the English/Japanese summaries.
- Update the job-time notice if fields, providers, purposes, or retention
  changes.
- Add or update a fail-closed runtime gate for any condition that cannot be
  inferred safely from credentials alone.
- Run `make verify`.
- After deployment, verify `/privacy`, `/terms`, the job submission notice, and
  that no Google Analytics network request occurs before consent.

Record the review date at the top of this file. Review quarterly even when no
provider change is planned, because provider terms and subprocessor locations
can change independently of the code.
