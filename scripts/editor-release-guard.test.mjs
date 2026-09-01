import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requireFromWeb = createRequire(
  path.join(repositoryRoot, "web", "package.json"),
);
const postcss = requireFromWeb("postcss");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("legacy editor global CSS remains byte-for-byte at the approved baseline", async () => {
  const css = await source("web/app/globals.css");
  const digest = createHash("sha256").update(css).digest("hex");

  assert.equal(
    digest,
    "ea8eef742165fb63879246876d0e5b9dc8ed9351966835d54a72dc0fe4f8a4ab",
    "Do not change the approved global CSS baseline without a dedicated public UI review.",
  );
});

test("every candidate editor selector is scoped below editor-v2-root", async () => {
  const css = await source("web/app/editor-v2.css");
  const root = postcss.parse(css);

  root.walkRules((rule) => {
    for (const selector of rule.selectors) {
      assert.match(
        selector.trim(),
        /^\.editor-v2-root(?:\b|\s|>|\+|~|:|\[)/,
        `Unscoped candidate selector: ${selector}`,
      );
    }
  });
});

test("release switches default to legacy and v2 saving is server-authorized", async () => {
  const [resolver, subtitleRelease, page, route, editor, migration] = await Promise.all([
    source("web/lib/editor-rendering-release.ts"),
    source("web/lib/subtitle-template-release.ts"),
    source("web/app/projects/[projectNumber]/edit/[shortId]/page.tsx"),
    source("web/app/api/shorts/[shortId]/apply-edit/route.ts"),
    source("web/app/shorts-app.tsx"),
    source("supabase/migrations/202607310003_editor_release_channels.sql"),
  ]);

  assert.match(
    resolver,
    /if \(!editorRenderingV2MasterEnabled\(environment\) \|\| !userId\) \{\s+return legacyAssignment;/,
  );
  assert.match(
    page,
    /resolveUnifiedTemplateSubtitleEditorContext\(db, session\.userId\)[\s\S]*editorRelease = resolvedEditorRelease/,
  );
  assert.match(
    subtitleRelease,
    /resolveEffectiveSubtitleTemplateContext[\s\S]*await readAccessContext\(\s*db,\s*userId,\s*lock/,
  );
  assert.match(
    subtitleRelease,
    /const release = resolvedRelease \?\? await resolveEditorRelease\(db, userId\)/,
  );
  assert.match(
    subtitleRelease,
    /lockEffectiveSubtitleTemplateAccess[\s\S]*resolveEffectiveSubtitleTemplateContext\(db, userId, true\)/,
  );
  assert.match(resolver, /coalesce\(release_user\.is_admin,false\) as user_is_admin/);
  assert.match(
    resolver,
    /state\.canaryEnabled\s+&& \(\s+successorAdminAllowed\s+\|\| \(state\.userIsAdmin && \(state\.testerEnabled \|\| emergencyTestUser\)\)\s+\|\| \(state\.testerEnabled && state\.candidateSubtitleEditingCapable\)\s+\)/,
  );
  const successorGuard = resolver.slice(
    resolver.indexOf("const successorAdminAllowed ="),
    resolver.indexOf(";", resolver.indexOf("const successorAdminAllowed =")),
  );
  for (const condition of [
    "state.userIsAdmin === true", "state.runtimeEnabled === true",
    "state.canaryEnabled === true", "state.renderV4KillSwitch === false",
    "state.successorAdminReleaseId === state.candidateReleaseId",
    "state.candidateDocumentVersion === 3",
    "state.candidateFontManifestSha256 === state.stableFontManifestSha256",
    "exactEditorRenderV4Capability",
  ]) assert.ok(successorGuard.includes(condition), `Missing exact successor guard: ${condition}`);
  assert.match(resolver, /shorts_mvp\.editor_target_successor_admin_release\(\$\{userId\}::uuid\)/);
  assert.match(page, /const editorSaveEnabled = editorRelease\.channel !== "legacy"/);
  assert.match(route, /if \(release\.channel === "legacy" \|\| !release\.releaseId\)/);
  assert.match(editor, /editor-v2-root/);
  assert.match(
    editor,
    /data-editor-release-channel=\{\s*overlayPreviewEnabled \? editorRelease\.channel : undefined/,
  );
  assert.match(
    editor,
    /body: JSON\.stringify\(\{\s*startSeconds,\s*endSeconds,\s*hookTitle:/,
  );
  assert.match(
    migration,
    /public_enabled boolean not null default false/,
  );
  assert.match(
    migration,
    /canary_enabled boolean not null default false/,
  );
});

test("editor release migration is additive and keeps legacy requests nullable", async () => {
  const migration = await source(
    "supabase/migrations/202607310003_editor_release_channels.sql",
  );

  assert.doesNotMatch(migration, /\bdrop\s+(table|column)\b/i);
  assert.match(
    migration,
    /add column if not exists release_id uuid/,
  );
  assert.match(
    migration,
    /release_id is null\s+and release_channel is null/,
  );
  assert.match(migration, /protect_editor_release_identity/);
  assert.match(migration, /protect_editor_render_request_release/);
  for (const table of [
    "editor_releases",
    "editor_release_state",
    "editor_release_testers",
    "editor_release_checks",
  ]) {
    assert.match(
      migration,
      new RegExp(`alter table shorts_mvp\\.${table} enable row level security`),
    );
    assert.match(
      migration,
      new RegExp(`revoke all on shorts_mvp\\.${table} from anon,authenticated`),
    );
  }
});

test("candidate renders use an isolated outbox while legacy rerenders stay unchanged", async () => {
  const [route, migration, legacyDispatcher, candidateDispatcher] = await Promise.all([
    source("web/app/api/shorts/[shortId]/apply-edit/route.ts"),
    source("supabase/migrations/202608010001_editor_render_canary_outbox.sql"),
    source("infra/aws/lambda/outbox_dispatcher.py"),
    source("infra/aws/lambda/editor_outbox_dispatcher.py"),
  ]);

  assert.match(
    route,
    /insert into shorts_mvp\.editor_render_outbox \(request_id,short_id\)/,
  );
  assert.match(migration, /create table if not exists shorts_mvp\.editor_render_outbox/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /enable row level security/);
  assert.doesNotMatch(migration, /\bdrop\s+(table|column)\b/i);
  assert.match(legacyDispatcher, /rpc\/claim_short_outbox/);
  assert.doesNotMatch(legacyDispatcher, /claim_editor_render_outbox/);
  assert.match(candidateDispatcher, /rpc\/claim_editor_render_outbox/);
  assert.doesNotMatch(candidateDispatcher, /claim_short_outbox/);
});

test("release workflow promotes one tested digest without deploying the website", async () => {
  const [workflow, registrar, browserParityRunner] = await Promise.all([
    source(".github/workflows/editor-release.yml"),
    source("infra/aws/lambda/editor_release_registrar.py"),
    source("scripts/run-editor-v4-browser-worker-parity-matrix.py"),
  ]);

  assert.equal(
    workflow.match(/docker\/build-push-action@/g)?.length,
    1,
    "The editor release workflow must build the render image exactly once.",
  );
  const actionReferences = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)]
    .map((match) => match[1]);
  assert.ok(actionReferences.length >= 7);
  for (const reference of actionReferences) {
    assert.match(
      reference,
      /@[0-9a-f]{40}$/,
      `Privileged release action must use a full commit SHA: ${reference}`,
    );
  }
  assert.match(workflow, /provenance: false/);
  assert.match(
    workflow,
    /build-args:\s*\|\s*WORKER_SOURCE_GIT_SHA=\$\{\{ github\.sha \}\}/,
  );
  assert.match(workflow, /image_digest: \$\{\{ steps\.image\.outputs\.digest \}\}/);
  assert.match(workflow, /Resolve an existing immutable release tag on workflow retry/);
  assert.doesNotMatch(workflow, /register-editor-release-job\.sh/);
  assert.doesNotMatch(workflow, /register-editor-v4-project-lane\.sh/);
  assert.doesNotMatch(workflow, /aws batch (?:register-job-definition|submit-job)/);
  for (const lane of [
    "legacy_project",
    "source_range",
    "elevenlabs_transcription",
    "subtitle_templates",
    "unified_template_subtitles",
  ]) assert.match(registrar, new RegExp(lane));
  assert.match(registrar, /editor-release-probe/);
  assert.match(workflow, /make verify/);
  assert.match(workflow, /secrets\.EDITOR_TEST_DATABASE_URL/);
  assert.match(workflow, /secrets\.EDITOR_TEST_DATABASE_FINGERPRINT/);
  assert.match(workflow, /EDITOR_TEST_SUPABASE_PROJECT_REF/);
  assert.match(workflow, /PRODUCTION_SUPABASE_PROJECT_REF/);
  assert.match(
    workflow,
    /node scripts\/apply-supabase\.mjs --non-production[\s\S]*202608260008_editor_release_probe_attestation\.sql/,
  );
  assert.match(
    workflow,
    /202608260008_editor_release_probe_attestation\.sql[\s\\\n]*202608270001_fix_editor_release_object_cardinality\.sql/,
  );
  assert.doesNotMatch(workflow, /node scripts\/apply-supabase\.mjs\s*\n\s*$/m);
  assert.match(workflow, /EDITOR_RELEASE_ECR_REPOSITORY_URI/);
  assert.match(workflow, /\.projectTargets \| keys \| length == 5/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.doesNotMatch(workflow, /(?:create|update)-job-queue/);
  assert.match(
    workflow,
    /EDITOR_RELEASE_BUILD_ROLE_ARN: \$\{\{ vars\.EDITOR_RELEASE_BUILD_ROLE_ARN \}\}/,
  );
  assert.match(
    workflow,
    /EDITOR_RELEASE_VERIFIER_ROLE_ARN: \$\{\{ vars\.EDITOR_RELEASE_VERIFIER_ROLE_ARN \}\}/,
  );
  assert.doesNotMatch(workflow, /vars\.AWS_WORKER_BUILD_ROLE_ARN/);
  assert.match(
    workflow,
    /github\.ref == 'refs\/tags\/editor-v4-render-parity-20260902-3'/,
  );
  assert.deepEqual(
    [...new Set(workflow.match(/editor-v4-render-parity-[0-9]{8}-[0-9]+/g))],
    ["editor-v4-render-parity-20260902-3"],
  );
  assert.equal(workflow.match(/fetch-depth: 0/g)?.length, 2);
  assert.equal(workflow.match(/fetch-tags: true/g)?.length, 2);
  assert.match(workflow, /git tag --points-at HEAD/);
  assert.doesNotMatch(workflow, /refs\/heads\//);
  assert.match(workflow, /environment: editor-v4-release-approval/);
  assert.doesNotMatch(workflow, /unified-template-subtitles-admin-canary/);
  assert.match(workflow, /action:"startProbe"/);
  assert.match(workflow, /action:"finalizeRelease"/);
  assert.match(workflow, /editor-font-manifest/);
  assert.match(workflow, /\.checks\["runtime-identity"\] == true/);
  assert.match(workflow, /\.runtimeIdentity == \{/);
  assert.match(registrar, /EDITOR_RELEASE_GIT_SHA/);
  assert.match(workflow, /"cssToAssBaselineOffsetEm","cssToAssScale","fontId","postscriptName","resolvedPath","sha256","titleBaselineOffsetEm","wordSpaceAdvanceEm"/);
  assert.match(workflow, /"paperlogy":"Paperlogy-7Bold\.ttf"/);
  assert.match(
    workflow,
    /\{fallbackDetected,entries:\(\.entries \| sort_by\(\.fontId\)\)\}/,
  );
  assert.match(workflow, /worker-title-compositor-parity/);
  assert.match(workflow, /worker-caption-noop-parity/);
  assert.match(workflow, /browser-worker-visual-parity/);
  assert.match(workflow, /run-editor-v4-browser-worker-parity-matrix\.py/);
  assert.match(browserParityRunner, /for attempt in range\(2\)/);
  assert.match(browserParityRunner, /_failure_detail\(error\)/);
  assert.match(workflow, /--worker-manifest probe-manifest\.json/);
  assert.match(workflow, /maximumPixelErrorPixels <= 2/);
  assert.match(workflow, /browser-worker-parity\/report\.json/);
  assert.match(workflow, /allEditorFontsBothCaptionModes/);
  assert.match(workflow, /allEditorFontsTitleMatrix/);
  assert.match(workflow, /browserParityReportJson:\$browserParityReportJson/);
  assert.match(workflow, /browserParityReportSha256:\$browserParityReportSha256/);
  assert.match(workflow, /githubOidcToken:\$githubOidcToken/);
  assert.match(workflow, /audience=editor-v4-release-registrar/);
  assert.match(workflow, /--version-id "\$manifest_version"/);
  assert.match(workflow, /--version-id "\$matrix_version"/);
  assert.match(workflow, /releaseIdentity:\{/);
  assert.doesNotMatch(workflow, /browserParityReportUri/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact/);
  assert.doesNotMatch(workflow, /startsWith\(github\.ref/);
  assert.doesNotMatch(workflow, /\b(vercel deploy|cdk deploy)\b/);

  assert.match(registrar, /def _start_v4_probe/);
  assert.match(registrar, /def _finalize_v4_release/);
  assert.match(registrar, /reserve_editor_release_probe_v4/);
  assert.match(registrar, /attach_editor_release_probe_job_v4/);
  assert.match(registrar, /attach_editor_release_probe_evidence_v4/);
  assert.match(registrar, /finalize_editor_render_v4_release/);
  assert.match(registrar, /shorts-mvp-editor-release-\{git_sha\[:12\]\}/);
  assert.match(registrar, /shorts-mvp-editor-test-release-\{git_sha\[:12\]\}-\{nonce\[:8\]\}/);
  assert.match(registrar, /-4vcpu/);
  assert.match(registrar, /EDITOR_RELEASE_REGISTRAR_PASS_ROLE_ARNS/);
  assert.match(registrar, /forced_task_role_arn=os\.environ\["EDITOR_TEST_TASK_ROLE_ARN"\]/);
  assert.match(registrar, /"command": \["python", "-m", "shorts_worker", "editor-release-probe"\]/);
  assert.match(registrar, /version_id=matrix_contract\["versionId"\]/);
  assert.match(registrar, /release_identity=release_identity/);
  assert.doesNotMatch(registrar, /:latest/);
  assert.doesNotMatch(registrar, /docker\s+(build|push)/);
});

test("production runbook applies and verifies migrations 007, 008, and 009 before bootstrap", async () => {
  const runbook = await source("docs/aws-runbook.md");
  assert.match(
    runbook,
    /apply-supabase\.mjs --production[\s\\\n]*202608260007_editor_render_spec_v4_release_control\.sql/,
  );
  assert.match(
    runbook,
    /verify-editor-render-v4-release-control\.mjs --require-stopped/,
  );
  assert.match(
    runbook,
    /apply-supabase\.mjs --production[\s\\\n]*202608260008_editor_release_probe_attestation\.sql/,
  );
  assert.match(
    runbook,
    /202608260008_editor_release_probe_attestation\.sql[\s\\\n]*202608270001_fix_editor_release_object_cardinality\.sql/,
  );
  assert.match(
    runbook,
    /verify-editor-release-probe-attestation\.mjs --require-empty/,
  );
  assert.ok(
    runbook.indexOf("202608270001_fix_editor_release_object_cardinality.sql")
      < runbook.indexOf("--phase bootstrap"),
  );
});

test("render-spec v4 release control is additive, immutable, and off by default", async () => {
  const migration = await source(
    "supabase/migrations/202608260007_editor_render_spec_v4_release_control.sql",
  );

  for (const column of [
    "render_spec_version",
    "caption_render_spec_version",
    "font_manifest_sha256",
    "initial_render_spec_version",
    "initial_caption_render_spec_version",
    "initial_render_spec",
  ]) assert.match(migration, new RegExp(`add column if not exists ${column}`));
  assert.match(migration, /render_v4_rollout_percent in \(0,5,25,100\)/);
  assert.match(migration, /render_v4_kill_switch boolean not null default true/);
  assert.match(migration, /candidate\.status in \('canary_ready','canary_active','approved'\)/);
  assert.match(migration, /candidate\.staging_verified_at is not null/);
  assert.match(migration, /stable\.promoted_at is not null/);
  assert.match(migration, /p_job_queue_arn text/);
  assert.equal(
    migration.match(/project_target\.job_queue_arn=p_job_queue_arn/g)?.length,
    2,
  );
  assert.match(migration, /video_jobs_initial_render_spec_versions_check/);
  assert.match(migration, /initial_render_spec is null[\s\S]*jsonb_typeof\(initial_render_spec\)='object'/);
  assert.match(migration, /validate constraint generated_shorts_initial_render_spec_object_check/);
  assert.match(migration, /new\.render_spec_version[\s\S]*old\.font_manifest_sha256/);
  assert.match(
    migration,
    /before update or delete on shorts_mvp\.editor_release_project_targets/,
  );
  assert.match(
    migration,
    /grant select,insert on shorts_mvp\.editor_release_project_targets to service_role/,
  );
  assert.doesNotMatch(migration, /\bupdate\s+shorts_mvp\.(?:video_jobs|generated_shorts|editor_releases)\b/i);
  assert.doesNotMatch(migration, /\bdrop\s+(?:table|column)\b/i);
  const [jobsRoute, initialReleaseResolver] = await Promise.all([
    source("web/app/api/jobs/route.ts"),
    source("web/lib/initial-render-release.ts"),
  ]);
  assert.match(initialReleaseResolver, /resolve_initial_render_v4_release/);
  assert.match(jobsRoute, /resolveInitialRenderRelease/);
  assert.match(jobsRoute, /initial_render_spec_version, initial_caption_render_spec_version/);
  const admissionCheck = jobsRoute.indexOf("assertJobCreationAllowed({");
  const resolver = jobsRoute.indexOf("resolveInitialRenderRelease(tx,");
  const jobInsert = jobsRoute.indexOf("insert into shorts_mvp.video_jobs (");
  assert.ok(admissionCheck >= 0 && resolver > admissionCheck);
  assert.ok(jobInsert > resolver);
  assert.match(
    migration,
    /language plpgsql[\s\S]*volatile[\s\S]*for share of state,runtime/,
  );
});

test("the public v4 compiler flag is explicit and synchronized for candidate builds", async () => {
  const [example, sync, rollout] = await Promise.all([
    source(".env.example"),
    source("scripts/sync-vercel-env.sh"),
    source("docs/editor-rendering-v2-rollout.md"),
  ]);

  assert.match(example, /^NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED=false$/m);
  assert.match(sync, /NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED/);
  assert.match(
    rollout,
    /NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED=true[\s\S]*무별칭 후보를\s+빌드하기 전에/,
  );
});

test("subtitle editing is an immutable verified release capability", async () => {
  const migration = await source(
    "supabase/migrations/202608110001_editor_subtitle_editing_capability.sql",
  );

  assert.match(
    migration,
    /add column if not exists subtitle_editing_capable boolean not null default false/,
  );
  assert.match(migration, /protect_editor_release_identity/);
  assert.match(
    migration,
    /new\.subtitle_editing_capable[\s\S]*old\.subtitle_editing_capable/,
  );
  assert.doesNotMatch(migration, /\bupdate\s+shorts_mvp\.editor_releases\b/i);
  assert.doesNotMatch(migration, /\bdrop\s+(table|column)\b/i);
});

test("unified template subtitle canary uses an independent off-by-default flag", async () => {
  const migration = await source(
    "supabase/migrations/202608240002_unified_template_subtitles_canary_flag.sql",
  );

  assert.match(
    migration,
    /'unified_template_subtitles_canary',\s+false,/,
  );
  assert.match(migration, /on conflict \(flag_key\) do nothing/);
  assert.doesNotMatch(migration, /subtitle_templates_public/);
  assert.doesNotMatch(migration, /\bupdate\s+shorts_mvp\.runtime_feature_flags\b/i);
  assert.doesNotMatch(migration, /\bdrop\s+(table|column)\b/i);
});

test("candidate worker uses a pinned, scan-friendly image with render dependencies", async () => {
  const [dockerfile, overlays] = await Promise.all([
    source("worker/Dockerfile"),
    source("worker/shorts_worker/overlays.py"),
  ]);

  assert.match(
    dockerfile,
    /FROM python:3\.12-alpine3\.22@sha256:[a-f0-9]{64} AS worker-base/,
  );
  assert.match(dockerfile, /apk add --no-cache[\s\S]*deno[\s\S]*ffmpeg/);
  assert.match(
    dockerfile,
    /FROM python:3\.12-alpine3\.22@sha256:[a-f0-9]{64} AS worker-base[\s\S]*RUN apk add --no-cache --upgrade[\s\S]*libcrypto3=3\.5\.8-r0[\s\S]*libssl3=3\.5\.8-r0[\s\S]*openssl=3\.5\.8-r0/,
  );
  assert.match(dockerfile, /apk add --no-cache font-noto-cjk/);
  assert.match(dockerfile, /addgroup -g 10001 easycut/);
  assert.match(dockerfile, /adduser -D -H -u 10001 -G easycut easycut/);
  assert.match(dockerfile, /install -d -o easycut -g easycut -m 0700 \/scratch/);
  assert.doesNotMatch(dockerfile, /python:3\.12-slim/);
  assert.match(overlays, /\/usr\/share\/fonts\/noto\/NotoSansCJK-Bold\.ttc/);
  assert.match(overlays, /\/usr\/share\/fonts\/noto\/NotoSansCJK-Regular\.ttc/);
});

test("promotion and subtitle pilot enrollment are transactional, gated, and audited", async () => {
  const actions = await source(
    "web/app/admin/easycutcutcutcutcutcut/editor-release-actions.ts",
  );

  assert.match(actions, /getDb\(\)\.begin/);
  assert.match(actions, /select id,email,is_admin/);
  assert.doesNotMatch(actions, /EDITOR_RELEASE_TESTER_ADMIN_REQUIRED/);
  assert.match(actions, /editor_release_testers/);
  assert.match(actions, /const isolatedChecks = \[/);
  assert.match(actions, /const productionCanaryChecks = \[/);
  assert.match(actions, /"initial-project-admission"/);
  assert.match(actions, /allProjectDispatchTargets\(\)/);
  assert.match(actions, /EDITOR_RENDER_V4_PROJECT_TARGET_CAPABILITY_MISMATCH/);
  assert.match(actions, /editor_release\.promoted/);
  assert.match(actions, /editor_release\.rolled_back/);
  assert.match(
    actions,
    /editor_release\.unified_template_subtitles_canary_enabled/,
  );
  assert.match(
    actions,
    /editor_release\.unified_template_subtitles_canary_disabled/,
  );
  assert.match(actions, /rollbackScope: "unified_template_subtitles_v5_only"/);
  assert.match(actions, /canary_enabled=true/);
  assert.match(actions, /public_enabled=true/);
  assert.match(actions, /status='succeeded'/);
  assert.match(actions, /status='rolled_back'/);
});

test("non-production setup never mutates repository variables and editor outputs stay in the verified release flow", async () => {
  const [setup, readme, rollout] = await Promise.all([
    source("scripts/setup-infrastructure.sh"),
    source("README.md"),
    source("docs/editor-rendering-v2-rollout.md"),
  ]);

  assert.match(
    setup,
    /LEGACY_RERENDER_IMAGE_TAG="\$\{LEGACY_RERENDER_IMAGE_TAG:-\$WORKER_IMAGE_TAG\}"/,
  );
  assert.match(setup, /운영 전체 인프라 배포는 금지됩니다/);
  assert.match(setup, /legacyRerenderImageTag=\$LEGACY_RERENDER_IMAGE_TAG/);
  assert.doesNotMatch(setup, /gh variable set/);
  assert.doesNotMatch(setup, /EDITOR_TEST_(?:JOB_QUEUE|TEMPLATE_JOB_DEFINITION)/);
  assert.match(
    readme,
    /운영 GitHub 변수는 검증된 별도 release 절차에서만 갱신합니다/,
  );
  assert.match(rollout, /## GitHub Actions 설정/);
  assert.match(rollout, /EDITOR_TEST_JOB_QUEUE/);
  assert.match(rollout, /EDITOR_TEST_TEMPLATE_JOB_DEFINITION/);
  assert.match(
    rollout,
    /codex\/render-parity-v4-20260826[\s\S]*main.*임의 ref에서는 실행하지 않는다/,
  );
});
