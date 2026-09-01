import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  validateChangeSetId,
  validatePromotedProductionDeployment,
} from "./deploy-production-control-plane.mjs";

const source = fs.readFileSync(
  new URL("./deploy-production-control-plane.mjs", import.meta.url),
  "utf8",
);

test("patches and deploys only the exact validated Compute assembly", () => {
  assert.match(source, /buildExactControlPlaneTemplate/);
  assert.match(source, /validateControlPlaneTemplateDiff/);
  assert.match(
    source,
    /"cdk", "deploy", "--app", outputDirectory, stackName/,
  );
  assert.match(source, /"--method", "prepare-change-set"/);
  assert.match(source, /name === "--apply" \|\| name === "--all"/);
  assert.doesNotMatch(source, /db:migrate|sync-vercel-env|vercel\s+(?:deploy|promote)/);
  assert.match(source, /--batch-submitter-only/);
  assert.match(source, /BATCH_SUBMITTER_ONLY_UPDATES/);
});

test("requires a separate preview and hash-pinned change-set execution", () => {
  assert.match(source, /--prepare/);
  assert.match(source, /--execute-change-set/);
  assert.match(source, /validatePreparedChangeSet/);
  assert.match(source, /--expected-head/);
  assert.match(source, /--expected-registry-sha256/);
  assert.match(source, /--expected-template-sha256/);
  assert.match(source, /--no-disable-rollback/);
  assert.match(source, /stack-update-complete/);
  assert.match(source, /verify-production-project-target-jobs\.mjs/);
  assert.match(source, /required\(process\.env\.DATABASE_URL, "DATABASE_URL"\)/);
  assert.match(source, /process\.env\.PRODUCTION_DATABASE_FINGERPRINT/);
  assert.match(source, /name === "--apply"[\s\S]*금지됩니다/);
  assert.match(source, /CHANGE_SET_ID=\$\{changeSetId\}/);
  assert.match(source, /liveTemplate\(options\.region, options\.changeSetId\)/);
  assert.match(
    source,
    /exactChangeSet\(options\.region, options\.changeSetId, updateLogicalIds\)/,
  );
  assert.match(source, /"--change-set-name", options\.changeSetId/);
  assert.doesNotMatch(
    source,
    /"cloudformation", "execute-change-set"[\s\S]{0,250}"--change-set-name", options\.changeSetName/,
  );
});

test("accepts only an exact ChangeSetId ARN in the selected region", () => {
  const id = "arn:aws:cloudformation:ap-northeast-2:181651591905:changeSet/stage-a-control-plane/12345678-1234-1234-1234-123456789abc";
  assert.equal(validateChangeSetId(id, "ap-northeast-2"), id);
  assert.throws(
    () => validateChangeSetId("stage-a-control-plane", "ap-northeast-2"),
    /정확한 CloudFormation ARN/,
  );
  assert.throws(
    () => validateChangeSetId(id, "us-east-1"),
    /정확한 CloudFormation ARN/,
  );
});

test("runs the resources-only provenance preflight before both prepare and execute", () => {
  assert.match(source, /"--resources-only"/);
  assert.equal(
    source.match(/verifyProductionResources\(options\.region\);/g)?.length,
    2,
  );
  assert.match(
    source,
    /verifyProductionResources\(options\.region\);[\s\S]*verifyNonterminalProductionTargets\(\);/,
  );
});

test("pins live admission transitions and rechecks DB jobs immediately before execute", () => {
  assert.match(source, /lambda", "get-function-configuration"/);
  assert.match(source, /shorts-mvp-batch-submitter-production/);
  assert.equal(
    source.match(/verifyLiveAdmissionTransition\(options\.region\);/g)?.length,
    3,
  );
  assert.equal(
    source.match(/verifyNonterminalProductionTargets\(\);/g)?.length,
    3,
  );
  assert.match(
    source,
    /verifyLiveAdmissionTransition\(options\.region\);\s*verifyNonterminalProductionTargets\(\);\s*run\("aws", \[\s*"cloudformation", "execute-change-set"/,
  );
});

test("requires a clean descendant and immutable production inputs", () => {
  assert.match(source, /git", \["status", "--porcelain"\]/);
  assert.match(source, /merge-base", "--is-ancestor"/);
  assert.match(source, /--worker-image-tag/);
  assert.match(source, /--legacy-rerender-image-tag/);
  assert.match(source, /GITHUB_OIDC_PROVIDER_ARN/);
  assert.match(source, /VERCEL_OIDC_PROVIDER_ARN/);
});

test("pins the production AZ lookup context instead of regenerating subnet expressions", () => {
  const context = JSON.parse(fs.readFileSync(
    new URL("../infra/aws/cdk.context.json", import.meta.url),
    "utf8",
  ));
  assert.deepEqual(
    context["availability-zones:account=181651591905:region=ap-northeast-2"],
    [
      "ap-northeast-2a",
      "ap-northeast-2b",
      "ap-northeast-2c",
      "ap-northeast-2d",
    ],
  );
});

test("propagates the selected region into the exact synth and CDK deploy environment", () => {
  assert.match(source, /AWS_REGION: options\.region/);
  assert.match(source, /AWS_DEFAULT_REGION: options\.region/);
  assert.match(source, /cdk", "synth"[\s\S]*env: cdkEnvironment/);
  assert.match(source, /prepare-change-set[\s\S]*env: cdkEnvironment/);
});

test("fails closed when the promoted easycut deployment moved from the requested base", () => {
  const base = "f".repeat(40);
  const deployment = {
    target: "production",
    readyState: "READY",
    readySubstate: "PROMOTED",
    project: { name: "shorts" },
    meta: { gitCommitSha: base },
  };
  assert.equal(
    validatePromotedProductionDeployment(deployment, base, "shorts"),
    base,
  );
  assert.throws(
    () => validatePromotedProductionDeployment(
      { ...deployment, meta: { gitCommitSha: "a".repeat(40) } },
      base,
      "shorts",
    ),
    /운영 Git SHA가 기준선과 달라/,
  );
  assert.throws(
    () => validatePromotedProductionDeployment(
      { ...deployment, readySubstate: "STAGED" },
      base,
      "shorts",
    ),
    /promoted 운영 배포/,
  );
});
