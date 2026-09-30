# Community template administrator release

Baseline: promoted production `5f7a248b53c55b30495ead333f9bc9dd7bf9e9e9`
(`dpl_5E3c76qwf2TXR6uSAXKDwHmL2xJ5`). Production AWS account
`181651591905`; existing Supabase `mvcprswvfybudtopepuj`, `shorts_mvp` only.

The community template reuses SNS selection, localized copy generation,
snapshot persistence, editor, fonts, rendering and request outbox. Its copy
profile is the existing SNS 4:5 profile at every video ratio: one hook, one
body line, no hashtags. The header and all text positions are constant on a
1080×1920 canvas; only the embedded video rectangle changes. Brand color fills
the entire top rectangle, with automatic contrasting heading text.

`communityTemplateVersion: 1` accompanies `snsTemplateVersion: 1` for shared
pipeline dispatch. The community marker cannot be added/removed in editing.
UI capabilities, API admission, DB admission, editor ownership and worker
binding all enforce the administrator-only release. No public release pointer
or existing worker definition is replaced.

- Generation: `a7db3266-7fc0-4175-a818-39aaff712ad3`
- Editor: `601d3d10-62b9-47f2-a34e-78b53ab1ec99`
- Both use exact revisioned job definitions and image digests; generation and
  editor images have separate immutable digests to preserve release uniqueness.
- The dedicated worker rejects ordinary/SNS jobs; ordinary/SNS workers cannot
  satisfy the new immutable release identity.
- Existing SNS generation and editor release IDs stay available for old jobs.

Validation includes real FFmpeg/ffprobe generation and editing at all five
ratios, identical headers, top-edge brand color, audio, public-account denial,
and PostgreSQL admission tests preserving existing public guards. Cloud probes
are bounded to two jobs (generation AI copy and editing), 15 cases each, 900s
maximum per job and one attempt. Estimate: under USD 5 for probes/build/storage;
ordinary metered testing is authorized. No new recurring infrastructure.

Deployment must retain current production route parity and ordinary admission
fingerprints, test an unaliased candidate, and promote that exact deployment.
Local rendering alone does not establish production worker compatibility.

## White heading revision

Baseline: `48797db8b2a99679f477733bec9a8c88b9ed05a2`. The large top
heading now prefers white; only very light backgrounds (weighted sRGB brightness
>= 210/255, including yellow and white) use black. SNS title contrast is unchanged.
Generation `0641d236-5e76-467e-95f3-bf695e6d6083`; editor `11a62875-b24a-4874-9794-4aac13b0c305`. Previous generation/editor releases remain
registered. The new editor attests both community generation releases; old editor
requests retain their exact worker. No public settings or release pointers change.
