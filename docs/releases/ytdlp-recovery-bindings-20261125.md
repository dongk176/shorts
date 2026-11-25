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

## Verified reopening and one-hour observation

The owner subsequently authorized reopening immediately after the promoted
worker completes a real project, followed by one hour of observation. Eight
unique terminally failed projects during that hour require restoring creation
maintenance; intermediate retries are excluded. Existing browsing, editing and
downloads remain available. This replaces the earlier automatic 14:00 reopening.
The recovery deployment pins maintenance on without an automatic deadline. Its
exact tested deployment is retained for a creation-only rollback, preserving
all worker fixes. The open continuation changes only that maintenance pin.

## November 25 execution and submission repair

General release `ab0ebdb4-b925-432f-8d4a-40888d655339` was promoted through
the existing administrator controls after project 39995 completed five shorts,
two real editor renders completed, a downloaded file decoded successfully,
and regenerated comments persisted on reopening. The rollback selection drill
ran inside a rolled-back database transaction; it did not switch public users.
After promotion, project 39996 completed five shorts in 264 seconds and its
downloaded H.264/AAC output decoded successfully. These two creation projects
used bounded operator submissions through normal admission, quota and outbox
processing, not the browser's creation POST.

The closed deployment is `dpl_3HEZGc1UrApyGT4UJmmYGZu5kKsa` (`d6285c84`).
The open deployment is `dpl_esQtyFThH1Pdom2fPmM3hiDzu9qc` (`43085f4c`),
promoted at approximately 11:47 KST. Both retain all 321 production routes.

The first public language project, 39997, exposed a registration omission:
the three specialized catalogs had verified registries but lacked their five
rows each in `editor_release_project_targets`. The actual deployed submitter
rejected them with `Selected project target differs from verified v4 release evidence`.
The omission delayed submission; it was not a media extraction failure.
The missing 15 rows were added only after comparing the existing immutable
catalogs, passed image checks, and all 15 exact registered AWS definitions and
digests. No target checks were weakened, no existing binding was overwritten,
and no project or usage reservation was duplicated. Projects 39997 and 39998
then dispatched normally. The actual submitter's five language target checks
also passed against the repaired live records.

Future specialized registrations must create the five immutable project-target
rows in the same registration transaction. Before public selection, compare
every lane's release ID, source SHA, image digest, revisioned definition and
queue with those rows and exercise `_initial_render_v4_environment` using the
deployed submitter. Passing only the web admission SQL or the image component
probe does not verify this submission boundary.
