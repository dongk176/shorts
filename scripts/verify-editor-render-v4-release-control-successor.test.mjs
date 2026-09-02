import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import {
  assertProjectSuccessorLease, countSuccessorActiveJobs, exactJson,
  successorDefinitionHash, successorHash, validateProjectSuccessorOptions,
  readProjectSuccessorSnapshot,
  validateCancelledPredecessorRestoreSnapshot,
  validateSuccessorDefinitions, validateSuccessorLambdaEnvironment,
  validateSuccessorRegistryTransition, validateSuccessorSnapshot,
  verifySuccessorAwsDefinitions,
} from "./verify-editor-render-v4-release-control-successor.mjs";
import { PROJECT_TARGET_LANES } from "./production-project-targets.mjs";
import {
  collectProjectSuccessorRuntime, projectSuccessorContext,
  stageBChangeSetProvenanceSha256, stageBRequiresStopped, waitForStageBStackUpdate,
} from "./deploy-stage-b-release-control.mjs";

const OLD_ID = "11111111-1111-4111-8111-111111111111";
const NEW_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const OP_ID = "44444444-4444-4444-8444-444444444444";
const AWS_JOB = "55555555-5555-4555-8555-555555555555";
const ARN = "arn:aws:batch:ap-northeast-2:181651591905:";
const REPO = "181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts";
const FONT = "c".repeat(64);
const KEYS = Object.keys(PROJECT_TARGET_LANES);
const copy = structuredClone;

function fixture() {
  const oldRegistry = { version: 1, environment: "production", lanes: {} };
  const newRegistry = copy(oldRegistry);
  const target = (key, current) => ({
    releaseId: `${key}-${current ? "dddddddddddd" : "aaaaaaaaaaaa"}-v4`,
    workerSourceGitSha: (current ? "d" : "a").repeat(40),
    imageUri: `${REPO}@sha256:${(current ? "e" : "b").repeat(64)}`,
    jobDefinitionArn: `${ARN}job-definition/${key}-${current ? "dddddddddddd" : "aaaaaaaaaaaa"}:1`,
    jobQueueArn: `${ARN}job-queue/${key}`, renderSpecVersion: 4,
    captionRenderSpecVersion: 4, fontManifestSha256: FONT,
  });
  const dbTarget = (value) => ({ batchTargetReleaseId: value.releaseId,
    workerSourceGitSha: value.workerSourceGitSha, workerImageDigest: value.imageUri.split("@")[1],
    jobDefinitionArn: value.jobDefinitionArn, jobQueueArn: value.jobQueueArn });
  const definition = (value, editor) => ({
    jobDefinitionArn: value.jobDefinitionArn, status: "ACTIVE", type: "container",
    platformCapabilities: ["FARGATE"], retryStrategy: { attempts: 1 },
    timeout: { attemptDurationSeconds: 7200 }, propagateTags: true,
    containerProperties: {
      image: value.imageUri, jobRoleArn: "arn:aws:iam::181651591905:role/unchanged-worker",
      executionRoleArn: "arn:aws:iam::181651591905:role/unchanged-execution",
      resourceRequirements: [{ type: "MEMORY", value: "16384" }, { type: "VCPU", value: editor ? "4" : "8" }],
      environment: Object.entries({
        EDITOR_RELEASE_GIT_SHA: value.workerSourceGitSha,
        WORKER_IMAGE_DIGEST: value.imageUri.split("@")[1],
        EDITOR_RENDER_SPEC_VERSION: "4", EDITOR_CAPTION_RENDER_SPEC_VERSION: "4",
        EDITOR_FONT_MANIFEST_SHA256: FONT, YOUTUBE_PO_TOKEN_ENABLED: "true",
        INGESTION_EGRESS_MODE: "webshare_isp", FFMPEG_THREADS: "4",
      }).map(([name, value]) => ({ name, value })),
      secrets: [{ name: "PROXY_CONFIG", valueFrom: "arn:aws:secretsmanager:ap-northeast-2:181651591905:secret/synthetic-only" }],
    },
  });
  const proof = { sourceGitSha: "d".repeat(40), workerImageDigest: `sha256:${"e".repeat(64)}`,
    fontManifestSha256: FONT, oldTargets: {}, newTargets: {},
    compatibleSuccessor: { version: 1, predecessorReleaseId: OLD_ID,
      sourceGitSha: "a".repeat(40), workerImageDigest: `sha256:${"b".repeat(64)}`,
      fontManifestSha256: FONT, projectTargets: {} },
  };
  const definitions = [];
  for (const key of [...KEYS, "editor"]) {
    const old = target(key, false); const next = target(key, true);
    const oldDefinition = definition(old, key === "editor");
    definitions.push(oldDefinition, definition(next, key === "editor"));
    if (key === "editor") {
      proof.editorJobDefinitionArn = next.jobDefinitionArn;
      proof.compatibleSuccessor.editor = { jobDefinitionArn: old.jobDefinitionArn,
        contractSha256: successorDefinitionHash(oldDefinition) };
    } else {
      oldRegistry.lanes[key] = { schedulingMode: "fair_share", current: old, previous: null };
      newRegistry.lanes[key] = { schedulingMode: "fair_share", current: next, previous: { ...old, submitAsReleaseId: old.releaseId } };
      proof.oldTargets[key] = dbTarget(old); proof.newTargets[key] = dbTarget(next);
      proof.compatibleSuccessor.projectTargets[key] = { ...dbTarget(old), contractSha256: successorDefinitionHash(oldDefinition) };
    }
  }
  const context = { predecessorReleaseId: OLD_ID, successorReleaseId: NEW_ID, adminUserId: ADMIN,
    head: "9".repeat(40), base: "8".repeat(40), oldRegistry, newRegistry,
    oldRegistrySha256: successorHash(exactJson(oldRegistry)), newRegistrySha256: successorHash(exactJson(newRegistry)) };
  const flags = { publicEnabled: true, internalEnabled: false, rolloutPercent: 100, killSwitch: false, runtimeEnabled: true };
  const snapshot = { proof, flags, state: { stableReleaseId: OLD_ID, candidateReleaseId: NEW_ID }, operation: null };
  snapshot.operation = { ...copy(context), version: 1, id: OP_ID, phase: "fenced", flags: copy(flags), proof: copy(proof) };
  return { context, proof, definitions, snapshot };
}

test("online rotation requires all three exact opt-ins; the legacy stopped path is unchanged", () => {
  const { context } = fixture();
  assert.equal(validateProjectSuccessorOptions({ phase: "rotation" }), null);
  assert.equal(stageBRequiresStopped("rotation"), true);
  assert.equal(stageBRequiresStopped("bootstrap"), true);
  assert.equal(stageBRequiresStopped("rotation", context), false);
  assert.equal(stageBRequiresStopped("rotation", null, { adminUserId: ADMIN }), false);
  for (const phase of ["bootstrap", "renewal", "lockdown"]) assert.throws(() => stageBRequiresStopped(phase, context));
  assert.throws(() => stageBRequiresStopped("rotation", {}));
  assert.throws(() => stageBRequiresStopped("rotation", { ...context, adminUserId: "missing" }));
  assert.throws(() => stageBRequiresStopped("rotation", { ...context, successorReleaseId: OLD_ID }));
});

test("cancelled predecessor restore accepts only the frozen old registry with no candidate jobs", () => {
  const { context, snapshot } = fixture();
  const cancelled = copy(snapshot);
  cancelled.operation = {
    ...cancelled.operation,
    phase: "active",
    outcome: "cancel",
    activeReleaseId: OLD_ID,
    activeRegistry: copy(context.oldRegistry),
    runtime: { registrySha256: context.oldRegistrySha256 },
    oldRuntime: { registrySha256: context.oldRegistrySha256 },
  };
  cancelled.candidateJobs = 0;
  cancelled.localRegistrySha256 = context.oldRegistrySha256;
  cancelled.cancelledRegistrySha256 = context.newRegistrySha256;
  assert.deepEqual(
    validateCancelledPredecessorRestoreSnapshot(cancelled, context.oldRegistry).oldRegistry,
    context.oldRegistry,
  );
  for (const mutate of [
    (value) => { value.operation.outcome = "complete"; },
    (value) => { value.operation.activeReleaseId = NEW_ID; },
    (value) => { value.operation.activeRegistry = copy(context.newRegistry); },
    (value) => { value.localRegistrySha256 = "0".repeat(64); },
    (value) => { value.cancelledRegistrySha256 = "0".repeat(64); },
    (value) => { value.operation.runtime.registrySha256 = "0".repeat(64); },
    (value) => { value.candidateJobs = 1; },
    (value) => { value.flags.publicEnabled = false; },
  ]) {
    const changed = copy(cancelled);
    mutate(changed);
    assert.throws(() => validateCancelledPredecessorRestoreSnapshot(changed, context.oldRegistry));
  }
  assert.throws(() => validateCancelledPredecessorRestoreSnapshot(cancelled, context.newRegistry));
});

test("old/current identities, five lanes, queues, self previous and font4/4 must match finalized proof", () => {
  const { context, proof } = fixture();
  assert.equal(validateSuccessorRegistryTransition(context.oldRegistry, context.newRegistry, proof), context.newRegistry);
  for (const mutate of [
    (r) => { r.lanes.legacy_project.previous.submitAsReleaseId = r.lanes.legacy_project.current.releaseId; },
    (r) => { r.lanes.source_range.current.fontManifestSha256 = "0".repeat(64); },
    (r) => { r.lanes.elevenlabs_transcription.current.jobQueueArn += "-other"; },
    (r) => { r.lanes.subtitle_templates.schedulingMode = "fifo"; },
    (r) => { delete r.lanes.unified_template_subtitles; },
  ]) {
    const changed = copy(context.newRegistry); mutate(changed);
    assert.throws(() => validateSuccessorRegistryTransition(context.oldRegistry, changed, proof));
  }
});

test("durable state pins frozen public values and proof while allowing the canary pointer transition", () => {
  const { context, snapshot } = fixture();
  assert.equal(validateSuccessorSnapshot(snapshot, context, { requireFence: true }), snapshot);
  const promoted = copy(snapshot); promoted.state.stableReleaseId = NEW_ID; promoted.state.candidateReleaseId = null;
  assert.doesNotThrow(() => validateSuccessorSnapshot(promoted, context, { requireFence: true }));
  for (const mutate of [
    (s) => { s.flags.internalEnabled = true; },
    (s) => { s.flags.publicEnabled = false; },
    (s) => { s.operation.newRegistrySha256 = "f".repeat(64); },
    (s) => { s.operation.proof.sourceGitSha = "f".repeat(40); },
    (s) => { s.operation.phase = "active"; },
    (s) => { delete s.operation.version; },
  ]) {
    const changed = copy(snapshot); mutate(changed);
    assert.throws(() => validateSuccessorSnapshot(changed, context, { requireFence: true }));
  }
});

test("database snapshots preserve exact underscored lane names through camelCase row transforms", async () => {
  const { context, snapshot } = fixture();
  const statements = [];
  const tx = async (strings) => {
    const sql = strings.join("?");
    statements.push(sql);
    if (sql.includes("from shorts_mvp.editor_release_state")) {
      assert.match(sql, /render_v4_target_successor::text as operation/);
      return [{ ...snapshot.state, operation: JSON.stringify(snapshot.operation) }];
    }
    assert.match(sql, /\)::text as value/);
    return [{ value: JSON.stringify(sql.includes("_project_target_successor_contract")
      ? snapshot.proof : snapshot.flags) }];
  };
  const result = await readProjectSuccessorSnapshot(tx, context, { requireFence: true });
  assert.deepEqual(result.proof.oldTargets, snapshot.proof.oldTargets);
  assert.deepEqual(result.proof.compatibleSuccessor.projectTargets, snapshot.proof.compatibleSuccessor.projectTargets);
  assert.deepEqual(result.operation.newRegistry.lanes, context.newRegistry.lanes);
  assert.equal(result.proof.newTargets.legacyProject, undefined);
  assert.equal(statements.length, 3);
});

test("immutable definition proof preserves CPU/memory/PO/proxy/secret/FFmpeg contracts", () => {
  const { context, proof, definitions } = fixture();
  assert.match(validateSuccessorDefinitions(definitions, context, proof), /^[0-9a-f]{64}$/);
  for (const mutate of [
    (d) => { d.containerProperties.resourceRequirements[1].value = "16"; },
    (d) => { d.containerProperties.secrets[0].valueFrom += "other"; },
    (d) => { d.containerProperties.environment.find((x) => x.name === "YOUTUBE_PO_TOKEN_ENABLED").value = "false"; },
    (d) => { d.containerProperties.environment.find((x) => x.name === "INGESTION_EGRESS_MODE").value = "direct"; },
    (d) => { d.containerProperties.environment.find((x) => x.name === "FFMPEG_THREADS").value = "8"; },
    (d) => { d.containerProperties.environment.push({ name: "WORKER_IMAGE_DIGEST", value: "other" }); },
    (d) => { d.status = "INACTIVE"; },
  ]) {
    const changed = copy(definitions); mutate(changed[1]);
    assert.throws(() => validateSuccessorDefinitions(changed, context, proof));
  }
});

test("definition hash exactly matches the registrar Python canonicalization", () => {
  const { definitions } = fixture();
  const vector = copy(definitions[0]);
  vector.containerProperties.environment.push(...[
    ["FOO_BAR", "한글😀"], ["FOO", "prefix"], ["A_B", "underscore"], ["AB", "x\u007f"],
  ].map(([name, value]) => ({ name, value })));
  const source = fs.readFileSync(new URL("../infra/aws/lambda/editor_release_registrar.py", import.meta.url), "utf8");
  const python = `import ast, copy, hashlib, json, sys\np=json.load(sys.stdin)\nn=ast.parse(p['source'])\nselected=[x for x in n.body if isinstance(x, ast.FunctionDef) and x.name in ('_definition_contract','_successor_contract_sha256')]\nns={'Any':object,'deepcopy':copy.deepcopy,'json':json,'hashlib':hashlib}\nexec(compile(ast.Module(body=selected,type_ignores=[]),'registrar-contract','exec'),ns)\nprint(json.dumps([ns['_successor_contract_sha256'](d) for d in p['definitions']]))\n`;
  const actual = JSON.parse(execFileSync(process.env.PYTHON || "python3", ["-c", python], {
    input: JSON.stringify({ source, definitions: [definitions[0], vector] }), encoding: "utf8", timeout: 10_000,
  }));
  assert.deepEqual(actual, [definitions[0], vector].map(successorDefinitionHash));
});

test("AWS definition reads verify exact ready queues and preserve scheduling modes", () => {
  const { context, proof, definitions } = fixture();
  const queues = KEYS.map((key) => ({ jobQueueArn: context.newRegistry.lanes[key].current.jobQueueArn,
    state: "ENABLED", status: "VALID", schedulingPolicyArn: `${ARN}scheduling-policy/original` }));
  const calls = [];
  const aws = (args) => { calls.push(args); return args[1] === "describe-job-definitions" ? { jobDefinitions: definitions } : { jobQueues: queues }; };
  assert.match(verifySuccessorAwsDefinitions(context, proof, "ap-northeast-2", aws), /^[0-9a-f]{64}$/);
  assert.equal(calls[0].length - 3, 12);
  delete queues[0].schedulingPolicyArn;
  assert.throws(() => verifySuccessorAwsDefinitions(context, proof, "ap-northeast-2", aws));
  assert.equal(calls.every((args) => args[1].startsWith("describe-")), true);
});

test("Lambda runtime requires the bundled registry and exact five target environments", () => {
  const { context } = fixture(); const env = { PROJECT_TARGET_REGISTRY_PATH: "/var/task/production-project-targets.json", PROJECT_TARGET_REGISTRY_REQUIRED: "true" };
  for (const [key, prefix] of Object.entries(PROJECT_TARGET_LANES)) {
    env[`${prefix}_JOB_DEFINITION_ARN`] = context.newRegistry.lanes[key].current.jobDefinitionArn;
    env[`${prefix}_BATCH_QUEUE_ARN`] = context.newRegistry.lanes[key].current.jobQueueArn;
    env[`${prefix}_PREVIOUS_JOB_DEFINITION_ARN`] = context.newRegistry.lanes[key].previous.jobDefinitionArn;
  }
  assert.doesNotThrow(() => validateSuccessorLambdaEnvironment("submitter", env, context.newRegistry));
  assert.throws(() => validateSuccessorLambdaEnvironment("submitter", { ...env, PROJECT_TARGET_REGISTRY_REQUIRED: "false" }, context.newRegistry));
  assert.throws(() => validateSuccessorLambdaEnvironment("registrar", { ...env, PROJECT_TARGET_REGISTRY_JSON: "{}" }, context.newRegistry));
  assert.throws(() => validateSuccessorLambdaEnvironment("submitter", { ...env, SOURCE_RANGE_JOB_DEFINITION_ARN: "stale" }, context.newRegistry));
  assert.throws(() => validateSuccessorLambdaEnvironment("submitter", { ...env, LEGACY_PROJECT_PREVIOUS_JOB_DEFINITION_ARN: "stale" }, context.newRegistry));
});

test("lease acquire requires a fenced actual administrator and all four drain counters zero", async () => {
  const { context, snapshot } = fixture(); const drain = { unsubmittedJobs: 0, pendingOutbox: 0, unsubmittedClaims: 0, olderGenerationJobs: 0 };
  const tx = async (strings) => {
    const q = strings.join("");
    if (q.includes("app_users")) return [{ id: ADMIN }];
    if (q.includes("editor_release_state")) return [{ ...snapshot.state, operation: JSON.stringify(snapshot.operation) }];
    if (q.includes("_contract(")) return [{ value: JSON.stringify(snapshot.proof) }];
    if (q.includes("_flags(")) return [{ value: JSON.stringify(snapshot.flags) }];
    if (q.includes("_drain(")) return [{ value: drain }];
    throw new Error(q);
  };
  await assertProjectSuccessorLease(tx, context, { requireDrained: true });
  for (const key of Object.keys(drain)) {
    drain[key] = 1;
    await assert.rejects(assertProjectSuccessorLease(tx, context, { requireDrained: true }), /남았습니다/);
    drain[key] = 0;
  }
  snapshot.operation.phase = "admin_ready";
  await assert.rejects(assertProjectSuccessorLease(tx, context), /fenced/);
});

test("successor and default ChangeSets cannot share provenance, including predecessor identity", () => {
  const { context } = fixture();
  const base = { phase: "rotation", stackKey: "editor", base: context.base, head: context.head,
    registrySha256: context.newRegistrySha256, liveTemplateSha256: "a".repeat(64),
    candidateTemplateSha256: "b".repeat(64), editorCandidateTemplateSha256: "b".repeat(64) };
  const preserved = { ...base, successor: context };
  assert.notEqual(stageBChangeSetProvenanceSha256(base), stageBChangeSetProvenanceSha256(preserved));
  assert.notEqual(stageBChangeSetProvenanceSha256(preserved), stageBChangeSetProvenanceSha256({ ...preserved,
    successor: { ...context, oldRegistrySha256: "1".repeat(64) } }));
  const raw = JSON.stringify(context.oldRegistry, null, 2) + "\n";
  assert.equal(projectSuccessorContext({ successor: context }, { base: context.base, registrySha256: context.newRegistrySha256 }, context.newRegistry, raw).oldRegistrySha256,
    successorHash(raw));
});

test("live runtime evidence is observed, source-checked and rechecked instead of accepting supplied passed flags", async () => {
  const { context, proof } = fixture(); const calls = [];
  const dependencies = { readStack: () => ({}), readTemplate: (key) => ({ key }),
    verifyDefinitions: () => "d".repeat(64), countActiveJobs: () => 2,
    readLambda: async (name, registry, _region, options) => { calls.push({ name, registry, options });
      return { codeSha256: "a".repeat(64), revisionId: "observed" }; } };
  const runtime = await collectProjectSuccessorRuntime({ context, proof, region: "ap-northeast-2" }, dependencies);
  assert.equal(runtime.registrySha256, context.newRegistrySha256);
  assert.equal(calls.every((call) => call.registry === context.newRegistry && call.options.verifySource), true);
  const cancel = await collectProjectSuccessorRuntime({ context, proof, region: "ap-northeast-2", predecessor: true, cancel: true }, dependencies);
  assert.equal(cancel.candidateActiveJobs, 2);
  assert.equal(cancel.registrySha256, context.oldRegistrySha256);
  let version = 0;
  await assert.rejects(collectProjectSuccessorRuntime({ context, proof, region: "ap-northeast-2" },
    { ...dependencies, readTemplate: () => ({ version: ++version }) }), /변경/);
});

test("candidate active job cancellation evidence paginates and describes exact immutable jobs", () => {
  const { context } = fixture(); let pages = 0;
  const aws = (args) => {
    if (args[1] === "describe-jobs") return { jobs: [{ jobId: AWS_JOB, status: "RUNNING", jobDefinition: context.newRegistry.lanes.legacy_project.current.jobDefinitionArn }] };
    pages += 1;
    return { jobSummaryList: [{ jobId: AWS_JOB }], ...(pages === 1 ? { nextToken: "second" } : {}) };
  };
  assert.equal(countSuccessorActiveJobs(context.newRegistry, "ap-northeast-2", aws), 1);
  assert.equal(pages, 26);
  assert.throws(() => countSuccessorActiveJobs(context.newRegistry, "ap-northeast-2", () => ({ nextToken: "stuck" })), /완료되지/);
});

test("every CloudFormation heartbeat carries the exact successor fence context", async () => {
  const { context } = fixture(); const calls = [];
  await waitForStageBStackUpdate({ options: { region: "ap-northeast-2", successor: context }, stackKey: "editor",
    changeSetId: "unused", originalStackStatus: "UPDATE_COMPLETE", candidateTemplateSha256: "a".repeat(64),
    leaseOwner: `stage-b:rotation:${context.head}`, leaseId: OP_ID,
    dependencies: { renewLease: async (value) => calls.push(value), readStack: () => ({ StackStatus: "UPDATE_COMPLETE" }),
      readLiveTemplateSha256: () => "a".repeat(64) } });
  assert.equal(calls.length, 1); assert.equal(calls[0].successor, context);
});

test("legacy lease cannot clear the durable fence and explicit rotation does not write public flags", () => {
  const source = fs.readFileSync(new URL("./verify-editor-render-v4-release-control.mjs", import.meta.url), "utf8");
  assert.match(source, /await assertProjectSuccessorLease\(tx, successor, \{ requireDrained: true \}\)/);
  assert.match(source, /renderV4TargetSuccessor\.phase !== "active"/);
  assert.match(source, /render_v4_target_successor is null or render_v4_target_successor->>'phase'='active'/);
  const release = source.slice(source.indexOf("export async function releaseEditorRenderV4InfrastructureLease"));
  assert.doesNotMatch(release, /set render_v4_target_successor/);
  const migration = fs.readFileSync(new URL("../supabase/migrations/202608310003_project_target_successor.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /\bset\s+(?:public_enabled|render_v4_internal_enabled|render_v4_rollout_percent|render_v4_kill_switch)\s*=/i);
});

test("successor schema verifier follows the latest additive drain definition", () => {
  const source = fs.readFileSync(
    new URL("./verify-editor-render-v4-release-control-successor.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /project_target_successor_drain:[\s\S]*202609010003_ingestion_route_capacity_requeue\.sql/,
  );
  assert.match(
    source,
    /enforce_project_target_successor_admission:[\s\S]*202609020001_project_successor_admin_dual_admission\.sql/,
  );
  assert.match(source, /FUNCTION_MIGRATIONS\[functionName\] \|\| SUCCESSOR_MIGRATION/);
});
