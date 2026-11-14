# Japanese generation quality — 2026-11-14

Production web baseline: 6c0b44b7457ebba206364ca694b0558f44cc666a,
confirmed by current alias and Vercel deployment metadata for
`dpl_6d6PZ4qndRgmVvZMQ5tqVvTWjH9p`.
Worktree: `.tmp/japanese-quality-20261114`; branch `codex/japanese-quality-20261114`.
Existing AWS 181651591905, Supabase mvcprswvfybudtopepuj/shorts_mvp.
No lab is used; current lab is not assumed to mirror production.

The completion-email change joins output_language to the existing claim result
without altering schema, preferences, recipients, retries, or idempotency keys.
Japanese projects use Japanese subject, HTML and plain text; existing other
languages retain their previous behavior.

Japanese selection, comments, SNS copy and translation now share idiom/name
fidelity instructions. Caption/script translation receives bounded video-title
context to resolve ASR name ambiguity. Same-language Japanese remains untranslated.
Names are not replaced by a hardcoded dictionary, and source timing is retained.

Bounded verification: existing pending pop project 35210; one four-minute
Japanese source project using the owner's previously rights-confirmed source
Pd3p1ZpRU9A; limited AI comparisons and candidate builds. Initial metered cost
estimate KRW 5,000–30,000; no fixed recurring services or capacity increases.
Production worker images differ from web source; worker promotion must preserve
active source differences and exact registered targets. Local tests alone do
not prove production worker deployment.

Observed comparison: existing pipeline transliterated the ASR-mistaken name
임영웅 as イム・ヨンウン. New title context produced イ・ミョンハク for this
sample; 모의평가 became 模擬試験 and 호락호락하지 않다 became そう甘くはない.
This is a bounded sample, not a guarantee of all proper-name recognition.
