# Background image deployment runtime

`sharp` includes native code. A macOS `vercel build` can succeed and trace only
Darwin binaries, then fail with HTTP 500 in the Linux function. The build script
now refuses non-Linux Vercel builds and exercises real WebP encoding/decoding.
Background GET is independent of the upload decoder; decoder startup failure
returns a retryable POST error before allocating an upload reservation.

Use the current promoted commit as the baseline and a clean isolated worktree.
Run the normal tests and route-manifest release guard, then build on Vercel:

```sh
vercel deploy --prod --skip-domain
```

This intentionally performs a cloud build; do not pass `--prebuilt` with output
created on macOS or Windows. A matching Linux build environment can also produce
prebuilt output. Keep optional dependencies enabled when installing from the
lockfile. See https://sharp.pixelplumbing.com/install/#cross-platform.

Verify the actual unaliased candidate, including protected pages, job admission,
and `/api/background-assets` (anonymous requests must reach the JSON auth gate,
not an HTML 500). Check the cloud build's native-runtime result and compare the
candidate route manifest to the previous release. Promote this exact deployment
without rebuilding. Verify the signed-in background library and a small image
upload/selection without applying changes to an existing video.

2026-09-20 repair scope: existing production Vercel/Supabase/storage configuration;
no migrations, feature-flag, worker, queue or account changes. Local checks plus
one cloud candidate are expected to require a few build minutes and a small
synthetic image upload (well under 3 MB); any diagnostic retries remain bounded.
No new resources or recurring subscriptions are required.
