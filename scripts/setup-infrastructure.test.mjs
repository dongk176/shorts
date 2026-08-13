import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const script = fs.readFileSync(new URL("./setup-infrastructure.sh", import.meta.url), "utf8");

test("applies Supabase migrations before deploying worker infrastructure", () => {
  const migrationIndex = script.indexOf("npm run db:migrate");
  const deployIndex = script.indexOf("npm --prefix infra/aws run deploy");

  assert.notEqual(migrationIndex, -1);
  assert.notEqual(deployIndex, -1);
  assert.ok(migrationIndex < deployIndex);
});

test("does not re-import the stack-managed Vercel OIDC provider", () => {
  assert.doesNotMatch(
    script,
    /vercel_oidc_arn=.*list-open-id-connect-providers/,
  );
  assert.match(script, /if \[\[ -n "\$\{VERCEL_OIDC_PROVIDER_ARN:-\}" \]\]; then/);
  assert.match(script, /vercelOidcProviderArn=\$VERCEL_OIDC_PROVIDER_ARN/);
});

test("pins the legacy rerender image separately from new worker deployments", () => {
  assert.match(
    script,
    /LEGACY_RERENDER_IMAGE_TAG=.*currently deployed known-good rerender image tag/,
  );
  assert.match(
    script,
    /legacyRerenderImageTag=\$LEGACY_RERENDER_IMAGE_TAG/,
  );
  assert.match(script, /protected_legacy_tag="legacy-rerender-/);
  assert.match(script, /aws ecr put-image/);
});

test("publishes editor release workflow variables only from the matching stacks", () => {
  assert.match(
    script,
    /EDITOR_RELEASE_BUILD_ROLE_ARN[\s\S]*EditorReleaseBuildRoleArn EditorCanary/,
  );
  assert.match(
    script,
    /EDITOR_RELEASE_ECR_REPOSITORY_URI[\s\S]*EditorReleaseRepositoryUri Foundation/,
  );
  assert.match(
    script,
    /EDITOR_PRODUCTION_TEMPLATE_JOB_DEFINITION[\s\S]*RerenderFargateBatchJobDefinition Compute/,
  );
  assert.match(
    script,
    /if \[\[ "\$\{INCLUDE_EDITOR_TEST:-false\}" == "true" \]\]; then/,
  );
  assert.match(
    script,
    /EDITOR_TEST_JOB_QUEUE[\s\S]*EditorTestBatchJobQueue EditorTest/,
  );
  assert.match(
    script,
    /EDITOR_TEST_TEMPLATE_JOB_DEFINITION[\s\S]*EditorTestTemplateJobDefinitionArn EditorTest/,
  );
});
