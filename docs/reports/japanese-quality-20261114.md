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

## Production verification

Email deployment dpl_ySU5Hs4Vsmx4pnvvHvSXQJe1uz8b (7e0e1b0) was promoted
after five protected-page checks and 636 identical registered function paths.
Project 35214 mail 01a1d893-7fb2-717d-a5f3-49f3a5d6489b was delivered with
Japanese subject, HTML lang=ja and Japanese plain text.

Pop 35210 completed five clips. Native Japanese 35214 completed four clips,
auto-detected jpn. All nine files decode. Native Japanese retained pop word
highlighting; translated pop retains the existing translated-basic policy.
Native ASR still contains errors in LoRA/Civitai and other terms.
Full-frame inspection appeared to hide footer pixels. Cropped original-frame
inspection and pixel counts show intact names in both decoders. This was an
inspection-preview artifact, not evidence of a production crop defect.

Worker candidates use exact active component sources and immutable image bases:
language 8c1412a -> 4b6dd007; SNS e5ac690 -> a730f071. Renderer, fonts, editor
document format and dependencies are unchanged. Both exact image cloud probes
passed; all 69 fresh frame hashes match the active language release's verified,
versioned manifest. Browser parity evidence is inherited by exact frame equality,
not misrepresented as a new browser execution.

Mail SQL, Japanese prompt, translation and SNS targeted tests pass. Full suite
found existing stale CSS checksum and admin heading expectations; both reproduced
on unchanged production baseline. These checks were not relaxed. Three new
prompt failures were fixed by keeping added instructions Japanese-only,
affirmative and free of Korean-language examples; corresponding tests now pass.

Initial registration names failed the application admission schema. Admission was
restored to the previous release, with no jobs referencing the rejected versions.
Immutable registry protection was retained; corrected definitions use new release
identities. Both real registries now pass the unchanged application schema and
admission functions. The previous registered versions remain preserved.
