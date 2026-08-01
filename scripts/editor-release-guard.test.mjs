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
    "427309c0b5f3a5b5fa0571003d854ec562e4b7201ee6ba60aa49dea7f327b6fb",
    "Do not change legacy global CSS in an editor candidate. Put candidate styles in editor-v2.css.",
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
  const [resolver, page, route, editor, migration] = await Promise.all([
    source("web/lib/editor-rendering-release.ts"),
    source("web/app/projects/[projectNumber]/edit/[shortId]/page.tsx"),
    source("web/app/api/shorts/[shortId]/apply-edit/route.ts"),
    source("web/app/shorts-app.tsx"),
    source("supabase/migrations/202607310003_editor_release_channels.sql"),
  ]);

  assert.match(
    resolver,
    /if \(!editorRenderingV2MasterEnabled\(environment\) \|\| !userId\) \{\s+return legacyAssignment;/,
  );
  assert.match(page, /editorRelease = await resolveEditorRelease/);
  assert.match(resolver, /coalesce\(release_user\.is_admin,false\) as user_is_admin/);
  assert.match(
    resolver,
    /state\.canaryEnabled\s+&& state\.userIsAdmin\s+&& \(state\.testerEnabled \|\| emergencyTestUser\)/,
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
  assert.match(workflow, /editor-release-probe/);
  assert.match(workflow, /make verify/);
  assert.match(workflow, /secrets\.EDITOR_TEST_DATABASE_URL/);
  assert.match(workflow, /EDITOR_TEST_SUPABASE_PROJECT_REF/);
  assert.match(workflow, /PRODUCTION_SUPABASE_PROJECT_REF/);
  assert.match(workflow, /EDITOR_RELEASE_ECR_REPOSITORY_URI/);
  assert.match(
    workflow,
    /github\.ref == 'refs\/heads\/main' \|\| github\.ref == 'refs\/heads\/codex\/editor-v2-canary-release'/,
  );
  assert.doesNotMatch(workflow, /startsWith\(github\.ref/);
  assert.doesNotMatch(workflow, /\b(vercel deploy|cdk deploy)\b/);

  assert.match(registrar, /shorts-mvp-editor-release-\$\{git_sha:0:12\}/);
  assert.match(registrar, /shorts-mvp-editor-test-release-\$\{git_sha:0:12\}/);
  assert.match(registrar, /\$\{repository_uri\}@\$\{image_digest\}/);
  assert.doesNotMatch(registrar, /:latest/);
  assert.doesNotMatch(registrar, /docker\s+(build|push)/);
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

test("admin promotion is transactional, gated, and audited", async () => {
  const actions = await source(
    "web/app/admin/easycutcutcutcutcutcut/editor-release-actions.ts",
  );

  assert.match(actions, /getDb\(\)\.begin/);
  assert.match(actions, /select id,email,is_admin/);
  assert.match(actions, /if \(!user\.isAdmin\)/);
  assert.match(actions, /const isolatedChecks = \[/);
  assert.match(actions, /const productionCanaryChecks = \[/);
  assert.match(actions, /editor_release\.promoted/);
  assert.match(actions, /editor_release\.rolled_back/);
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
