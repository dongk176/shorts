import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  assertChangeSetProvenance,
  classifyStageBStackObservation,
  shouldReleaseStageBInfrastructureLease,
  stageBChangeSetName,
  stageBChangeSetProvenanceSha256,
  stageBTemplateSha256,
  validatePromotedStageBDeployment,
  validateRotationChangedPaths,
  validateStageBChangeSetId,
  waitForStageBStackUpdate,
} from "./deploy-stage-b-release-control.mjs";

const source = fs.readFileSync(
  new URL("./deploy-stage-b-release-control.mjs", import.meta.url),
  "utf8",
);

test("pins a clean exact HEAD to the actual promoted production SHA", () => {
  assert.match(source, /git", \["status", "--porcelain", "--untracked-files=all"\]/);
  assert.match(source, /git", \["rev-parse", "HEAD"\]/);
  assert.match(source, /git", \["merge-base", "--is-ancestor"/);
  assert.match(source, /\/v13\/deployments\/easycut\.co\.kr/);
  assert.match(source, /readySubstate !== "PROMOTED"/);
  assert.match(source, /actualSha !== expectedBase/);

  const base = "a".repeat(40);
  const deployment = {
    target: "production",
    readyState: "READY",
    readySubstate: "PROMOTED",
    project: { name: "shorts" },
    meta: { gitCommitSha: base },
  };
  assert.equal(validatePromotedStageBDeployment(deployment, base, "shorts"), base);
  assert.throws(
    () => validatePromotedStageBDeployment(
      { ...deployment, meta: { gitCommitSha: "b".repeat(40) } },
      base,
      "shorts",
    ),
    /운영 Git SHA가 기준선과 달라/,
  );
});

test("rotation accepts only a registry-only commit after the bootstrap head", () => {
  assert.deepEqual(
    validateRotationChangedPaths(["production-project-targets.json", ""]),
    ["production-project-targets.json"],
  );
  assert.throws(
    () => validateRotationChangedPaths([
      "production-project-targets.json",
      "infra/aws/lib/stacks.ts",
    ]),
    /한 파일만 변경/,
  );
  assert.match(source, /--prior-stage-head/);
  assert.match(source, /--diff-filter=ACDMRTUXB/);
});

test("synthesizes exact Editor and Compute templates with the phase ref", () => {
  assert.match(source, /"cdk",\s*"synth"/);
  assert.match(source, /STAGE_B_STACKS\[stackKey\]\.stackName/);
  assert.match(source, /githubEditorReleaseRef: STAGE_B_PHASE_CONTRACTS\[options\.phase\]\.editorReleaseRef/);
  assert.match(source, /buildExactStageBTemplate/);
  assert.match(source, /validateExactStageBTemplate/);
  assert.match(source, /stageBTemplateSha256/);
  assert.match(source, /liveTemplate\(stackKey, options\.region\)/);
  assert.match(source, /registrarPassRoleArns\(registry, identity\)/);
  assert.match(source, /"batch",\s*"describe-job-definitions"/);
  assert.match(source, /definitions\[0\]\.status !== "ACTIVE"/);
  assert.match(source, /GITHUB_REPOSITORY_ID/);
  assert.match(source, /GITHUB_REPOSITORY_OWNER_ID/);
  assert.match(source, /editorReleaseRegistrarPassRoleArns/);
});

test("prepares exact change sets only and cleans partial prepares on failure", () => {
  assert.match(source, /"s3api",\s*"put-object"/);
  assert.match(source, /"--checksum-algorithm",\s*"SHA256"/);
  assert.match(source, /"--checksum-sha256",\s*checksumSha256/);
  assert.match(source, /"--server-side-encryption",\s*"AES256"/);
  assert.match(source, /get-bucket-versioning/);
  assert.match(source, /versionId=\$\{encodeURIComponent\(versionId\)\}/);
  assert.match(source, /"cloudformation",\s*"create-change-set"/);
  assert.match(source, /"--change-set-type",\s*"UPDATE"/);
  assert.match(source, /UsePreviousValue=true/);
  assert.match(source, /"--role-arn",\s*roleArn/);
  assert.match(source, /"cloudformation",\s*"wait"[\s\S]*"change-set-create-complete"/);
  assert.match(source, /validatePreparedStageBChangeSet/);
  assert.match(source, /prepared template hash가 exact 후보와 다릅니다/);
  assert.match(source, /cleanupPreparedChangeSets/);
  assert.match(source, /assertChangeSetNameUnused/);
  assert.match(source, /동일한 change set 이름이 이미 존재합니다/);
  assert.match(source, /"delete-change-set"/);
  assert.match(source, /name === "--prepare"/);
  assert.match(source, /\["--apply", "--all", "--deploy", "--execute-all"\]/);
  assert.doesNotMatch(source, /"cdk",\s*"deploy"/);
  assert.doesNotMatch(source, /"--method",\s*"direct"/);
});

test("executes Editor and Compute separately and derives the Editor-first gate internally", () => {
  assert.match(source, /--execute-editor-change-set/);
  assert.match(source, /--execute-compute-change-set/);
  assert.match(source, /synthesizeStageBTemplates/);
  assert.match(source, /validateAppliedStageBTemplate/);
  assert.match(source, /exact HEAD 내부 합성과 live 적용 검증 결과/);
  assert.match(source, /"cloudformation",\s*"execute-change-set"/);
  assert.match(source, /"--no-disable-rollback"/);
  assert.doesNotMatch(source, /stack-update-complete/);
  assert.match(source, /waitForStageBStackUpdate/);
  assert.match(source, /실행 직전에 변경되었습니다/);
});

test("binds each prepared ChangeSet to exact provenance and revalidates it", () => {
  const provenance = {
    phase: "rotation",
    stackKey: "compute",
    base: "a".repeat(40),
    head: "b".repeat(40),
    registrySha256: "c".repeat(64),
    liveTemplateSha256: "d".repeat(64),
    candidateTemplateSha256: "e".repeat(64),
    editorCandidateTemplateSha256: "f".repeat(64),
  };
  const digest = stageBChangeSetProvenanceSha256(provenance);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(
    stageBChangeSetName(provenance),
    `stage-b-rotation-compute-${digest.slice(0, 48)}`,
  );
  assert.notEqual(
    stageBChangeSetName({ ...provenance, head: "9".repeat(40) }),
    stageBChangeSetName(provenance),
  );
  assert.match(source, /assertChangeSetProvenance/);
  assert.match(source, /ChangeSetName !== expectedName/);
  assert.match(source, /stageBChangeSetName\(provenance\)/);
  assert.match(source, /--change-set-prefix는 사용할 수 없습니다/);

  const name = stageBChangeSetName(provenance);
  const id = `arn:aws:cloudformation:ap-northeast-2:181651591905:changeSet/${name}/12345678-1234-1234-1234-123456789abc`;
  const prepared = { ChangeSetName: name, ChangeSetId: id };
  assert.equal(assertChangeSetProvenance(prepared, name, id), prepared);
  assert.throws(
    () => assertChangeSetProvenance(
      prepared,
      `${name.slice(0, -1)}0`,
      id,
    ),
    /exact phase\/stack\/base\/head\/registry\/template provenance/,
  );
  const tamperedId = id.replace(`:changeSet/${name}/`, ":changeSet/other/");
  assert.throws(
    () => assertChangeSetProvenance(
      { ...prepared, ChangeSetId: tamperedId },
      name,
      tamperedId,
    ),
    /exact phase\/stack\/base\/head\/registry\/template provenance/,
  );
});

test("holds a renewable durable DB lease through CloudFormation execution", () => {
  assert.match(source, /acquireEditorRenderV4InfrastructureLease/);
  assert.match(source, /renewEditorRenderV4InfrastructureLease/);
  assert.match(source, /releaseEditorRenderV4InfrastructureLease/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /const LEASE_TTL_SECONDS = 2 \* 60 \* 60/);
  assert.match(source, /shouldReleaseStageBInfrastructureLease/);
  assert.match(source, /terminal 상태가 불명확해 lease를 명시적으로 해제하지 않습니다/);
  assert.match(source, /await sleep\(10_000\)/);
  assert.doesNotMatch(source, /pg_advisory|session advisory/i);

  assert.equal(shouldReleaseStageBInfrastructureLease({
    leaseAcquired: true,
    executionMayHaveStarted: false,
    executionTerminalKnown: true,
  }), true);
  assert.equal(shouldReleaseStageBInfrastructureLease({
    leaseAcquired: true,
    executionMayHaveStarted: true,
    executionTerminalKnown: false,
  }), false);
  assert.equal(shouldReleaseStageBInfrastructureLease({
    leaseAcquired: true,
    executionMayHaveStarted: true,
    executionTerminalKnown: true,
  }), true);
});

test("keeps polling rollback and treats only observed terminal rollback as final", () => {
  const rollingBack = classifyStageBStackObservation({
    stackStatus: "UPDATE_ROLLBACK_IN_PROGRESS",
    candidateTemplateMatches: false,
    changeSetExecutionStatus: "EXECUTE_IN_PROGRESS",
  });
  assert.equal(rollingBack.state, "pending");
  assert.equal(rollingBack.stackActivityObserved, true);

  const rolledBack = classifyStageBStackObservation({
    stackStatus: "UPDATE_ROLLBACK_COMPLETE",
    candidateTemplateMatches: false,
    changeSetExecutionStatus: "EXECUTE_COMPLETE",
    executionActivityObserved: rollingBack.activityObserved,
    stackUpdateActivityObserved: rollingBack.stackActivityObserved,
  });
  assert.equal(rolledBack.state, "rolled_back");

  const preexistingRollback = classifyStageBStackObservation({
    stackStatus: "UPDATE_ROLLBACK_COMPLETE",
    candidateTemplateMatches: false,
    changeSetExecutionStatus: "AVAILABLE",
  });
  assert.equal(preexistingRollback.state, "pending");
  const directlyObservedRollback = classifyStageBStackObservation({
    stackStatus: "UPDATE_ROLLBACK_COMPLETE",
    originalStackStatus: "UPDATE_COMPLETE",
    candidateTemplateMatches: false,
    changeSetExecutionStatus: "EXECUTE_COMPLETE",
  });
  assert.equal(directlyObservedRollback.state, "rolled_back");

  const succeeded = classifyStageBStackObservation({
    stackStatus: "UPDATE_COMPLETE",
    candidateTemplateMatches: true,
    changeSetExecutionStatus: "EXECUTE_COMPLETE",
  });
  assert.equal(succeeded.state, "succeeded");
  assert.match(source, /Only a success or observed rollback is terminal/);
  assert.match(source, /lease 갱신 실패[\s\S]*terminal 상태를 계속 확인/);
});

test("reconciles rollback, renewal failure, and unknown execution", async () => {
  const base = {
    options: { region: "ap-northeast-2" },
    stackKey: "editor",
    changeSetId: "change-set-id",
    originalStackStatus: "UPDATE_COMPLETE",
    originalTemplateSha256: "a".repeat(64),
    candidateTemplateSha256: "b".repeat(64),
    leaseOwner: `stage-b:lockdown:${"c".repeat(40)}`,
    leaseId: "12345678-1234-4123-8123-123456789abc",
  };

  let rollbackNow = 0;
  const rollbackStatuses = [
    "UPDATE_ROLLBACK_IN_PROGRESS",
    "UPDATE_ROLLBACK_COMPLETE",
  ];
  await assert.rejects(
    waitForStageBStackUpdate({
      ...base,
      dependencies: {
        now: () => rollbackNow,
        wait: async (milliseconds) => { rollbackNow += milliseconds; },
        renewLease: async () => {},
        readStack: () => ({ StackStatus: rollbackStatuses.shift() }),
        readChangeSet: () => ({ ExecutionStatus: "EXECUTE_COMPLETE" }),
        readLiveTemplateSha256: () => base.originalTemplateSha256,
        warn: () => {},
      },
    }),
    /rollback terminal 상태/,
  );

  let ambiguousNow = 0;
  await assert.rejects(
    waitForStageBStackUpdate({
      ...base,
      deadlineMs: 5_000,
      dependencies: {
        now: () => ambiguousNow,
        wait: async (milliseconds) => { ambiguousNow += milliseconds; },
        renewLease: async () => {},
        readStack: () => ({ StackStatus: "UPDATE_COMPLETE" }),
        readChangeSet: () => ({ ExecutionStatus: "AVAILABLE" }),
        readLiveTemplateSha256: () => base.originalTemplateSha256,
        warn: () => {},
      },
    }),
    /terminal 상태 감시 시간이 초과/,
  );

  let renewalAttempts = 0;
  const warnings = [];
  const succeeded = await waitForStageBStackUpdate({
    ...base,
    dependencies: {
      renewLease: async () => {
        renewalAttempts += 1;
        throw new Error("temporary database outage");
      },
      readStack: () => ({ StackStatus: "UPDATE_COMPLETE" }),
      readLiveTemplateSha256: () => base.candidateTemplateSha256,
      warn: (message) => warnings.push(message),
    },
  });
  assert.equal(succeeded.StackStatus, "UPDATE_COMPLETE");
  assert.equal(renewalAttempts, 1);
  assert.match(warnings.join(""), /기존 2시간 lease/);

  let unknownNow = 0;
  await assert.rejects(
    waitForStageBStackUpdate({
      ...base,
      deadlineMs: 5_000,
      dependencies: {
        now: () => unknownNow,
        wait: async (milliseconds) => { unknownNow += milliseconds; },
        renewLease: async () => {},
        readStack: () => ({ StackStatus: "UPDATE_IN_PROGRESS" }),
        readChangeSet: () => ({ ExecutionStatus: "EXECUTE_IN_PROGRESS" }),
        readLiveTemplateSha256: () => base.originalTemplateSha256,
        warn: () => {},
      },
    }),
    /terminal 상태 감시 시간이 초과/,
  );
});

test("accepts only an exact ChangeSet ARN in the selected region", () => {
  const id = "arn:aws:cloudformation:ap-northeast-2:181651591905:changeSet/stage-b-bootstrap-editor/12345678-1234-1234-1234-123456789abc";
  assert.equal(validateStageBChangeSetId(id, "ap-northeast-2"), id);
  assert.throws(
    () => validateStageBChangeSetId("stage-b-bootstrap-editor", "ap-northeast-2"),
    /정확한 CloudFormation ARN/,
  );
  assert.throws(
    () => validateStageBChangeSetId(id, "us-east-1"),
    /정확한 CloudFormation ARN/,
  );
  assert.throws(
    () => validateStageBChangeSetId(
      id.replace(
        "12345678-1234-1234-1234-123456789abc",
        "123456781234-1234-1234-123456789abc",
      ),
      "ap-northeast-2",
    ),
    /정확한 CloudFormation ARN/,
  );
});

test("does not mix Stage A, DB, Vercel mutation, Queue, CE, or JobDefinition actions", () => {
  assert.doesNotMatch(source, /deploy-production-control-plane/);
  assert.doesNotMatch(
    source,
    /(?:db:migrate|apply-supabase|sync-vercel-env|vercel\s+(?:deploy|promote|env)|register-job-definition|update-job-queue|update-compute-environment)/,
  );
  assert.doesNotMatch(source, /AWS::Batch::(?:JobQueue|ComputeEnvironment|JobDefinition)/);
});

test("renews a failed immutable candidate through an Editor-only exact phase", () => {
  assert.match(source, /\["renewal", "lockdown"\][\s\S]*executeStack === "compute"/);
  assert.match(
    source,
    /options\.phase === "renewal" \? "bootstrap" : options\.phase/,
  );
  assert.match(source, /renewal은 exact Editor preview\/해시만/);
});

test("requires the separately applied production v4 schema before any AWS mutation", () => {
  assert.match(source, /verifyEditorRenderV4ReleaseControl/);
  assert.match(source, /verifyEditorReleaseProbeAttestation/);
  assert.match(source, /async function verifyStageBDatabaseContracts/);
  assert.match(source, /requireStopped: options\.phase !== "lockdown"/);
  assert.match(
    source,
    /verifyPromotedProductionBaseline\(options\.base\)[\s\S]*await verifyStageBDatabaseContracts/,
  );
  assert.match(
    source,
    /exactChangeSet\(options\.phase, stackKey[\s\S]*await verifyStageBDatabaseContracts[\s\S]*"execute-change-set"/,
  );
  assert.match(
    source,
    /assertChangeSetNameUnused[\s\S]*await verifyStageBDatabaseContracts[\s\S]*prepareChangeSet/,
  );
  assert.doesNotMatch(source, /node scripts\/apply-supabase/);
});

test("canonical template hashing is key-order independent", () => {
  assert.equal(
    stageBTemplateSha256({ Resources: { B: 2, A: 1 } }),
    stageBTemplateSha256({ Resources: { A: 1, B: 2 } }),
  );
});
