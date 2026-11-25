# Extraction recovery: specialized generation and editor bindings

The release continuation descends from promoted web `0ac4a03e914109e8e7f853b6e66500ef9c6b979d`.
Production AWS is `181651591905` in Seoul; database is `mvcprswvfybudtopepuj/shorts_mvp`.
The user's November 25 request authorizes bounded new-version tests and production worker promotion only after verification.

The general image `14d240f7` preserves the currently deployed editing recovery runtime (`43fd7590`),
while specialized generation images `f969c8be` independently preserve each existing family's
runtime. Social editor images `a35625d1` preserve the current `fd35cadf` editor code and add the
new generation IDs. These are separate immutable images, not a wholesale worker build from web.
See the adjacent image recipe documents for exact bases. The general image differs more widely
from the old `ce70d546` generation runtime because the live editor recovery must remain available;
its full production canary is still required.

## Verified before registration

- CI full `make verify` in the general image build job passed; workflow finalization is separate.
- All four exact generation images passed 4-minute public-source download, OpenAI transcription,
  and a 15-second 1080×1920 render/decode check. Download durations: general 18.66s, language 21.47s,
  SNS 22.03s, community 24.03s. These component probes do not write customer projects or claim
  complete application-flow verification.
- Each specialized actual image passed 55 ingestion/runtime tests and 110 inherited renderer tests.
- SNS and community generation images each passed their existing 15-case synthetic template probe.
- Both new social editor images passed actual AWS request identity validation (including rejection
  of four mismatches) and the unified social editing probe with versioned test-bucket artifacts.
- `scripts/ytdlp-recovery-bindings.test.mjs` tests the actual observed DB guard baseline plus the
  additive migration in local Postgres: all five lanes, original/new ownership bindings, historical
  editor compatibility, and missing/incorrect proof. Its synthetic proof data is **only unit-test data**.
- `scripts/verify-ytdlp-submitter-overlay.py` verifies 26 valid/invalid binding cases and all five
  pre-existing exact editor identities. Only two existing functions differ in the deployed module.

## Deployment sequence and remaining gates

Do not select new public workers from this document alone. Obtain final actual 69-case matrix
proof and the trusted general registrar result, register new catalogs with their actual evidence,
apply the additive DB guards, and install the reviewed one-module editor submitter overlay using
its observed revision ID. Keep all old catalog entries, images and AWS definitions.
The packaging script rejects any other deployed archive and verifies all other ZIP members unchanged.

Then complete the existing guarded project-target successor rotation, real administrator canary,
and unaliased web candidate route/creation/edit/download checks before exact candidate promotion.
The language setting retains its current enabled/rollout values when its tested release is selected.
Web changes only select the tested new SNS/community generation and compatible social editor IDs;
old generation IDs stay accepted for existing videos. Do not change payment, proxy/token secrets,
queues, capacity, publishing gates, or the existing creation-only maintenance deadline.

The Supabase preflight reported existing unrelated search-path/auth advisories; this migration
retains all five functions' fixed search paths and existing privileges, and changes no RLS or grants.
