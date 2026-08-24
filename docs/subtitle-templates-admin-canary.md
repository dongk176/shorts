# Subtitle template admin canary

> Current-operation note: the rollout steps below document the original
> subtitle-template suite. That suite may already be public in production.
> Never reset its public/runtime flags to the historical values in this
> document while releasing unified v5. Unified v5 is activated and rolled back
> only with `unified_template_subtitles_canary`.

The three finished subtitle templates are isolated from every stable project,
source-range, editor, and ElevenLabs-transcription route. A candidate is usable
only when all of these controls agree:

| `SUBTITLE_TEMPLATES_ENABLED` | `subtitle_templates` | `subtitle_templates_public` | Result |
| --- | --- | --- | --- |
| off | any | any | every request stays on its existing path |
| on | off | any | every request stays on its existing path |
| on | on | off | admitted admins may create caption-template jobs |
| on | on | on | reserved for a later separately approved public rollout |

The first production migration creates both runtime flags as `false`. Build the
single web candidate with `SUBTITLE_TEMPLATES_ENABLED=true`, but keep both DB
flags `false` while that exact artifact is verified and promoted. Changing the
Vercel environment after the build would create a different deployment and is
not an allowed activation mechanism. Do not enable `subtitle_templates_public`
during this release.

## Immutable preview and render layout

All compatible caption templates use the same server-authored 1080x1920 layout in
both the browser card and the worker render spec. Hook-title placement follows
the selected ratio instead of using one fixed top rectangle. The 16:9 video is
at y=432 with its caption in a separate 840x140 box 48px below the video. The
5:4 and 1:1 video positions follow the established preset positions and keep
captions inside the actual video near its lower edge. The 4:5 title uses the
same y=96 safe area as full-height 9:16, while its video starts at y=420; its
caption ends above the channel row, and the channel row occupies y=1610
through y=1770 inside the video. Full-height 9:16 keeps the video at y=0 and
the caption at y=1430. Caption-template hook titles never render text
background rectangles, even when legacy title style data contains one. Each
highlight and pop style can independently use a centered 840x140 caption box
that is centered exactly on the actual video rectangle for every aspect ratio.

New projects select one of the two canonical styles, `pop` or `highlight`, and
choose `captionPlacement=lower` or `captionPlacement=center` separately. The
immutable style snapshot still stores the existing canonical database id and
the selected placement, so the database and trusted Batch allowlist remain
unchanged. Previously completed snapshots that used the old combined selection
labels remain readable. The retired `basic` id remains readable by the worker
and stored-data constraints solely so existing completed or pinned jobs do not
break.

Provider word timestamps remain unchanged. Only the displayed start frame is
advanced by four 30fps frames (about 133ms); the word end frame is preserved so a
caption never disappears before the spoken word ends. Overlapping provider
timestamps are serialized with at least one output frame per word. A caption
layout failure is recorded separately from transcription failure and must never
be shown to the user as “no human voice”.

## Candidate target

Build the worker image once and record its immutable digest. Register a new Job
Definition by cloning the currently verified ElevenLabs admin definition:

```sh
bash scripts/register-subtitle-template-job.sh \
  "$ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN" \
  "sha256:<digest>" \
  "<git-sha>"
```

The script does not deploy a CDK stack, replace compute capacity, or update a
queue. Configure the exact returned ARN together with the existing isolated
ElevenLabs queue ARN:

- `SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN`
- `SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN`

Keep the previous ElevenLabs `:1` ARN configured as well. The Batch submitter
allowlist accepts each exact pair independently, so an in-flight job or retry
continues on the definition stored when that job was created.

The currently live Batch submitter source does not know the new pair. Adding
only the environment values intentionally remains fail-closed and every caption
job would be rejected as an untrusted stored target. Before activation, download
and preserve the live `shorts-mvp-batch-submitter-production` function package,
configuration, environment, and `CodeSha256`. Compare that source with this
candidate and prepare a minimal function update whose only source change is the
reviewed `infra/aws/lambda/batch_submitter.py` change and whose only
configuration additions are the two exact candidate ARN values. Preserve every
other live source file, environment value, timeout, memory, role, VPC setting,
and trigger. Stop if that narrow diff cannot be demonstrated.

The existing submitter execution role already grants `batch:SubmitJob` with
`Resource: *`. Therefore the minimal Lambda code/configuration update does not
require an IAM or complete Compute stack deployment. The Lambda still fails
closed in application code unless the stored job target is one of the exact
trusted definition/queue pairs. Recheck the live role before activation; if the
live policy differs, stop rather than deploying the complete Compute stack as a
shortcut.

## Safe activation and rollback

The unified v5 template subtitle canary has an additional independent runtime
flag, `unified_template_subtitles_canary`. Its additive migration seeds the flag
as `false` without changing `subtitle_templates` or any public flag. Enable it
only after the capable editor canary and designated administrator tester are in
place. To stop only new unified v5 work, set
`unified_template_subtitles_canary=false`; do not change `subtitle_templates`,
because that switch also controls the existing subtitle-template suite.

1. Apply `202608080001_subtitle_templates_admin_canary.sql`; verify both flags
   are still `false`.
2. Register and scan the immutable candidate image and Job Definition.
3. Preserve and compare the live submitter artifact, then deploy only the
   reviewed submitter code change and the two candidate ARN additions. Do not
   deploy the complete Compute stack. Verify ordinary, source-range, and
   ElevenLabs jobs retain their exact previous targets before proceeding.
4. Deploy the unaliased web candidate with
   `SUBTITLE_TEMPLATES_ENABLED=true` while both DB flags remain `false`. Verify
   the protected routes and confirm no account receives the caption UI.
5. Promote that exact web deployment without rebuilding it. Recheck ordinary,
   source-range, and ElevenLabs creation while both DB flags are still `false`.
6. Set only `subtitle_templates=true` in the DB, leaving
   `subtitle_templates_public=false`, and run the admitted-admin canary.

To stop the entire existing subtitle-template suite, set
`subtitle_templates=false` first. Do not use this for a unified-v5-only
rollback. The web master
may remain enabled because the DB gate then returns no capability; changing the
Vercel environment is not required for emergency rollback. Do not change or
terminate healthy pinned jobs. The nullable schema additions and minimal
submitter allowlist may remain in place, and all legacy rows keep the three new
fields `null`.
