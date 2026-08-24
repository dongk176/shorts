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
    "78142a84f8bae4a819a8caf8416bd82b4265c6358424b51666739dc5825d5dfb",
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
    /resolveUnifiedTemplateSubtitleEditorContext[\s\S]*const editorRelease = await resolveEditorRelease\(db, userId\)/,
  );
  assert.match(resolver, /coalesce\(release_user\.is_admin,false\) as user_is_admin/);
  assert.match(
    resolver,
    /state\.canaryEnabled\s+&& \(\s+\(state\.userIsAdmin && \(state\.testerEnabled \|\| emergencyTestUser\)\)\s+\|\| \(state\.testerEnabled && state\.candidateSubtitleEditingCapable\)\s+\)/,
  );
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
  const [workflow, registrar] = await Promise.all([
    source(".github/workflows/editor-release.yml"),
    source("scripts/register-editor-release-job.sh"),
  ]);

  assert.equal(
    workflow.match(/docker\/build-push-action@/g)?.length,
    1,
    "The editor release workflow must build the render image exactly once.",
  );
  assert.match(workflow, /provenance: false/);
  assert.match(workflow, /EDITOR_RELEASE_IMAGE_DIGEST: \$\{\{ steps\.build\.outputs\.digest \}\}/);
  assert.match(workflow, /register-editor-release-job\.sh \\\s+isolated/);
  assert.match(workflow, /register-editor-release-job\.sh \\\s+production/);
  assert.match(
    workflow,
    /register-editor-release-job\.sh \\\s+unified-template-subtitles \\\s+"\$UNIFIED_TEMPLATE_SUBTITLES_TEMPLATE_JOB_DEFINITION"/,
  );
  assert.match(
    workflow,
    /release\.targets\.subtitleTemplates\.jobDefinitionArn/,
  );
  assert.match(workflow, /editor-release-probe/);
  assert.match(workflow, /make verify/);
  assert.match(workflow, /secrets\.EDITOR_TEST_DATABASE_URL/);
  assert.match(workflow, /EDITOR_TEST_SUPABASE_PROJECT_REF/);
  assert.match(workflow, /PRODUCTION_SUPABASE_PROJECT_REF/);
  assert.match(
    workflow,
    /node scripts\/apply-supabase\.mjs \\\s+202607310003_editor_release_channels\.sql \\\s+202608010001_editor_render_canary_outbox\.sql \\\s+202608080001_subtitle_templates_admin_canary\.sql \\\s+202608110001_editor_subtitle_editing_capability\.sql \\\s+202608240002_unified_template_subtitles_canary_flag\.sql/,
  );
  assert.doesNotMatch(workflow, /node scripts\/apply-supabase\.mjs\s*\n\s*$/m);
  assert.match(workflow, /EDITOR_RELEASE_ECR_REPOSITORY_URI/);
  assert.match(
    workflow,
    /UNIFIED_TEMPLATE_SUBTITLES_TEMPLATE_JOB_DEFINITION: \$\{\{ vars\.UNIFIED_TEMPLATE_SUBTITLES_TEMPLATE_JOB_DEFINITION \|\| 'shorts-mvp-project-heavy-fargate-production' \}\}/,
  );
  assert.match(
    workflow,
    /UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN: \$\{\{ vars\.UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN \}\}/,
  );
  assert.match(
    workflow,
    /job-queue\/shorts-mvp-prepare-production\$/,
  );
  assert.match(
    workflow,
    /UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN: \$\{\{ steps\.unified-template-subtitles-definition\.outputs\.unified_template_subtitles_job_definition_arn \}\}/,
  );
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.doesNotMatch(workflow, /(?:create|update)-job-queue/);
  assert.match(
    workflow,
    /EDITOR_RELEASE_BUILD_ROLE_ARN: \$\{\{ vars\.EDITOR_RELEASE_BUILD_ROLE_ARN \}\}/,
  );
  assert.doesNotMatch(workflow, /vars\.AWS_WORKER_BUILD_ROLE_ARN/);
  assert.match(
    workflow,
    /github\.ref == 'refs\/heads\/codex\/unified-template-subtitles-admin-canary-20260824'/,
  );
  assert.match(workflow, /uiVersion:3/);
  assert.match(workflow, /documentVersion:3/);
  assert.match(workflow, /subtitleEditingCapable:true/);
  assert.doesNotMatch(workflow, /startsWith\(github\.ref/);
  assert.doesNotMatch(workflow, /\b(vercel deploy|cdk deploy)\b/);

  assert.match(registrar, /shorts-mvp-editor-release-\$\{git_sha:0:12\}/);
  assert.match(registrar, /shorts-mvp-editor-test-release-\$\{git_sha:0:12\}/);
  assert.match(registrar, /-4vcpu/);
  assert.match(registrar, /candidate_vcpus="4"/);
  assert.match(registrar, /candidate_ffmpeg_threads="4"/);
  assert.match(registrar, /unified-template-subtitles\)/);
  assert.match(registrar, /shorts-mvp-project-heavy-fargate-production/);
  assert.match(registrar, /INGESTION_PROXY_ROUTES_JSON/);
  assert.match(registrar, /YOUTUBE_PO_TOKEN_ENABLED/);
  assert.match(registrar, /trusted ingestion Job Definition/);
  assert.match(registrar, /ephemeralStorage\.sizeInGiB == 30/);
  assert.match(registrar, /attemptDurationSeconds == 7200/);
  assert.match(
    registrar,
    /unified_template_subtitles_job_definition_arn=\$definition_arn/,
  );
  assert.match(
    registrar,
    /\{type:"VCPU",value:\$candidateVcpus\}/,
  );
  assert.match(
    registrar,
    /\{name:"TASK_VCPUS",value:\$candidateVcpus\}/,
  );
  assert.match(
    registrar,
    /\{name:"FFMPEG_THREADS",value:\$candidateFfmpegThreads\}/,
  );
  assert.match(registrar, /\$\{repository_uri\}@\$\{image_digest\}/);
  assert.match(registrar, /ascii_downcase \| startswith\("aws:"\) \| not/);
  assert.doesNotMatch(registrar, /:latest/);
  assert.doesNotMatch(registrar, /docker\s+(build|push)/);
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
  assert.match(dockerfile, /openssl=3\.5\.7-r0/);
  assert.match(dockerfile, /apk add --no-cache font-noto-cjk/);
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

test("infrastructure deploy keeps legacy rerenders pinned and editor test outputs opt-in", async () => {
  const setup = await source("scripts/setup-infrastructure.sh");

  assert.match(
    setup,
    /LEGACY_RERENDER_IMAGE_TAG=.*currently deployed known-good rerender image tag/,
  );
  assert.match(setup, /legacyRerenderImageTag=\$LEGACY_RERENDER_IMAGE_TAG/);
  assert.match(
    setup,
    /EDITOR_TEST_TEMPLATE_JOB_DEFINITION[\s\S]*EditorTestTemplateJobDefinitionArn EditorTest/,
  );
  assert.match(
    setup,
    /if \[\[ "\$\{INCLUDE_EDITOR_TEST:-false\}" == "true" \]\]; then/,
  );
});
