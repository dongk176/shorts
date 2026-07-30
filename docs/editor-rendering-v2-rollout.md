# Editor rendering v2 rollout

The v2 editor stores one validated 1080×1920 document and renders that exact
document in the AWS render worker. Keep the local experiment flag separate
from the production release gates.

## Required order

1. Run `make verify` and build the worker `render` Docker target.
2. Apply only:
   - `202607310001_ai_comment_regeneration_usage.sql`
   - `202607310002_editor_document_v2.sql`
3. Confirm `runtime_feature_flags.editor_rendering_v2=false`.
4. Publish immutable `linux/amd64` prepare and render images for the release
   commit SHA.
5. Deploy CDK with that SHA and confirm both rerender and initial-render job
   definitions reference immutable images.
6. Deploy the web build with `EDITOR_RENDERING_V2_ENABLED=false`. Existing
   users must still receive the legacy editor.
7. Set `EDITOR_RENDERING_V2_ENABLED=true` and put only the operator's
   authenticated user UUID in `EDITOR_RENDERING_V2_TEST_USER_IDS`.
8. Redeploy the web build and run the canary matrix below.
9. Remove the test-user allowlist, enable the DB runtime flag, and verify one
   final paid-user save before announcing the editor.

Never enable the DB runtime flag before the worker image and web build are both
live.

## Canary matrix

- Open an existing short with and without a captured edit timeline.
- Split, trim, and delete a middle video clip; verify the remaining clips
  ripple together and a second edit still opens the original edit timeline.
- Move and resize the video, title, channel, each comment, and added text.
- Delete a comment and verify its time range stays visually empty.
- Change title colors, fonts, text effects, background, template, comment
  theme, and channel image.
- Exercise all eight bundled fonts, a one-pixel text box, outline, shadow, and
  no-effect text.
- Regenerate exactly the current comment count and verify 60 seconds is
  consumed only after a valid Gemini response.
- Save, wait for `ready`, download the output, and verify 1080×1920 H.264/AAC,
  duration, cuts, layer order, timed overlays, and subtitles.
- Reopen the editor and confirm the successful document is restored.
- Repeat undo/redo before save for video cuts, comment add/delete/text, title
  text/style, channel text/image, and added text.

## Failure and rollback

- Web/API issue: set `EDITOR_RENDERING_V2_ENABLED=false` and redeploy. This
  immediately returns everyone to the legacy editor.
- Canary-only issue: remove the tester UUID while leaving the DB runtime flag
  false.
- Worker issue: deploy CDK with the last known-good immutable image SHA. Do not
  delete the failed release image until the incident is understood.
- A failed v2 render keeps the last successful output and `editor_document`;
  the pending request is marked failed and the edit lock is released after the
  final Batch retry.
- Migrations are additive. Do not drop the new columns or audit tables during
  an emergency rollback.
