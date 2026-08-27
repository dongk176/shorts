import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertBroadInfrastructureDeployAllowed } from "./deploy-infrastructure-all.mjs";

const script = fs.readFileSync(new URL("./setup-infrastructure.sh", import.meta.url), "utf8");
const infraPackage = JSON.parse(fs.readFileSync(
  new URL("../infra/aws/package.json", import.meta.url),
  "utf8",
));
const gitignore = fs.readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
const awsRunbook = fs.readFileSync(
  new URL("../docs/aws-runbook.md", import.meta.url),
  "utf8",
);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

test("applies Supabase migrations before deploying worker infrastructure", () => {
  const migrationIndex = script.indexOf("npm run db:migrate:non-production");
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

test("pins the legacy rerender image separately for retained non-production deployments", () => {
  assert.match(
    script,
    /LEGACY_RERENDER_IMAGE_TAG="\$\{LEGACY_RERENDER_IMAGE_TAG:-\$WORKER_IMAGE_TAG\}"/,
  );
  assert.match(
    script,
    /legacyRerenderImageTag=\$LEGACY_RERENDER_IMAGE_TAG/,
  );
  assert.match(script, /protected_legacy_tag="legacy-rerender-/);
  assert.match(script, /aws ecr put-image/);
});

test("fails closed before any production DB or broad CDK mutation and points to the exact Stage A flow", () => {
  const productionGuard = script.indexOf('if [[ "$ENVIRONMENT" == "production" ]]');
  const guardExit = script.indexOf("exit 2", productionGuard);
  const migration = script.indexOf("npm run db:migrate");
  const deploy = script.indexOf("npm --prefix infra/aws run deploy");
  assert.ok(productionGuard >= 0 && guardExit > productionGuard);
  assert.ok(guardExit < migration && guardExit < deploy);
  assert.match(script, /npm run infra:deploy-control-plane -- --base <promoted-git-sha>/);
  assert.match(script, /--prepare/);
  assert.match(script, /CHANGE_SET_ID ARN/);
  assert.equal(infraPackage.scripts.deploy, "node ../../scripts/deploy-infrastructure-all.mjs");
});

test("blocks a production CDK context even when DEPLOY_ENV claims staging", () => {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["--prefix", "infra/aws", "run", "deploy", "--", "-c", "environment=production"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, DEPLOY_ENV: "staging" },
    },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Production --all deploy is disabled/);
});

test("retains non-production setup while pinning the selected AWS region", () => {
  assert.match(script, /export AWS_REGION="\$REGION"/);
  assert.match(script, /export AWS_DEFAULT_REGION="\$REGION"/);
  assert.match(
    script,
    /AWS_REGION="\$REGION" AWS_DEFAULT_REGION="\$REGION"[\s\\\n]*npm --prefix infra\/aws run deploy/,
  );
  assert.doesNotThrow(() => assertBroadInfrastructureDeployAllowed({
    deployEnvironment: "staging",
    args: ["-c", "environment=staging"],
  }));
  assert.doesNotMatch(script, /bash scripts\/sync-vercel-env\.sh/);
  assert.doesNotMatch(script, /gh variable set/);
  assert.match(
    script,
    /Vercel production 환경변수와 GitHub Actions 저장소 변수는 변경하지 않았습니다/,
  );
});

test("documents only the exact Stage A production path and explicit non-production setup", () => {
  assert.match(
    awsRunbook,
    /npm run db:migrate:production --[\s\\\n]*202608260005_batch_target_and_stale_guards\.sql[\s\\\n]*202608260006_batch_target_and_stale_guards_validate\.sql/,
  );
  assert.match(awsRunbook, /npm run infra:deploy-control-plane --[\s\S]*--prepare/);
  assert.match(
    awsRunbook,
    /npm run infra:deploy-control-plane --[\s\S]*--execute-change-set "\$CHANGE_SET_ID"/,
  );
  assert.match(awsRunbook, /npm run vercel:sync-project-targets/);
  assert.match(
    awsRunbook,
    /vercel:verify-job-admission -- --url "\$CANDIDATE_URL"[\s\S]*vercel promote "\$CANDIDATE_URL"/,
  );
  assert.match(awsRunbook, /vercel promote "\$CANDIDATE_URL"/);
  assert.doesNotMatch(awsRunbook, /`scripts\/sync-vercel-env\.sh`를 실행/);
  assert.doesNotMatch(awsRunbook, /`npm run infra:setup`으로 운영/);

  assert.match(
    readme,
    /DEPLOY_ENV=staging[\s\\\n]*NON_PRODUCTION_DATABASE_FINGERPRINT=[^\n]+[\s\\\n]*npm run infra:setup/,
  );
  assert.match(readme, /infra:deploy-control-plane/);
  assert.match(readme, /vercel:sync-project-targets/);
  assert.match(readme, /Vercel[\s\S]*production 환경변수[\s\S]*변경하지[\s\S]*않습니다/);
  assert.match(
    readme,
    /GitHub Actions 저장소 변수를 변경하지[\s\S]*않습니다/,
  );
  assert.match(awsRunbook, /검증된 별도 release 절차에서만 갱신/);
});

test("ignores generated private keys and local secret material", () => {
  assert.match(gitignore, /^\.secrets\/$/m);
  assert.match(gitignore, /^\*\.pem$/m);
  assert.match(gitignore, /^\*\.key$/m);
});
