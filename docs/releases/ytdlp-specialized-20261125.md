# Specialized extraction recovery

Production web baseline: 0ac4a03e914109e8e7f853b6e66500ef9c6b979d.
The language, SNS and community generation families have independent immutable
registrations. Updating the normal project registry alone cannot repair them.

Build each candidate from its exact currently registered image in
worker/ytdlp-specialized-bases.json, not from the general candidate. The only
runtime changes are yt-dlp/default dependencies, the reviewed ingestion module
and the source identity marker. Family application code, prompts, renderers,
fonts, entrypoint, language behavior and editor support remain inherited.
The build source SHA identifies this assembly recipe, not a wholesale copy of
the web checkout's worker directory. Use immutable family-specific image tags.

Before registration, compare actual Batch definitions and image digests, test
the exact image's ingestion and runtime dependencies, run bounded four-minute
download/transcription/render/decode checks and existing synthetic renderer
checks. Record actual evidence; do not copy old passing checks to new images.
Register new definitions/catalog rows and preserve old project bindings.
Do not mutate a verified language release. Retain all editor compatibility
allowlists and prove new generation can still open/edit/download.

The public language selection can change only after its actual image and
registration pass. SNS/community require an unaliased web candidate and route
parity before changing their code-selected release IDs. No public traffic is
changed by building or probing these images. Existing maintenance ends at
14:00 KST; do not extend it implicitly. Tests use the authorized YxtZmF516EY
first four minutes, ordinary OpenAI transcription, one attempt per family and
20-minute timeouts. Initial test budget estimate: below USD 6 total; ordinary
metered costs already authorized. No new recurring resources.
