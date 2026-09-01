import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "../web/node_modules/postgres/src/index.js";
import { requireProductionDatabaseUrl } from "./production-database-identity.mjs";
import { PROJECT_TARGET_LANES, validateProductionProjectTargets } from "./production-project-targets.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const KEYS = ["legacy_project", "source_range", "elevenlabs_transcription", "subtitle_templates", "unified_template_subtitles"];
const SUCCESSOR_MIGRATION = path.join(
  ROOT,
  "supabase/migrations/202608310003_project_target_successor.sql",
);
const FUNCTION_MIGRATIONS = Object.freeze({
  project_target_successor_drain: path.join(
    ROOT,
    "supabase/migrations/202609010003_ingestion_route_capacity_requeue.sql",
  ),
});

export function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, ordered(value[key])]),
  );
  return value;
}

export const exactJson = (value) => JSON.stringify(ordered(value));
export const successorHash = (value) => crypto.createHash("sha256").update(value).digest("hex");

export function validateProjectSuccessorOptions(options) {
  const values = [options.successorReleaseId, options.expectedStableReleaseId, options.successorAdminUserId];
  if (values.every((value) => !value)) return null;
  if (options.phase !== "rotation" || values.some((value) => !UUID.test(String(value || "")))
    || options.successorReleaseId === options.expectedStableReleaseId || !SHA.test(options.head || "")) {
    throw new Error("successor는 rotation의 exact 새/기존 release UUID와 실제 관리자 UUID가 모두 필요합니다.");
  }
  return {
    predecessorReleaseId: options.expectedStableReleaseId,
    successorReleaseId: options.successorReleaseId,
    adminUserId: options.successorAdminUserId,
    head: options.head,
  };
}

export function validateSuccessorRegistryTransition(oldRegistry, newRegistry, proof) {
  validateProductionProjectTargets(oldRegistry);
  validateProductionProjectTargets(newRegistry);
  for (const key of KEYS) {
    const oldLane = oldRegistry.lanes[key];
    const newLane = newRegistry.lanes[key];
    const previous = { ...newLane.previous };
    delete previous.submitAsReleaseId;
    if (exactJson(previous) !== exactJson(oldLane.current)
      || (newLane.previous.submitAsReleaseId ?? previous.releaseId) !== previous.releaseId
      || newLane.schedulingMode !== oldLane.schedulingMode
      || newLane.current.imageUri.split("@")[0] !== oldLane.current.imageUri.split("@")[0]) {
      throw new Error(`successor ${key}의 기존 target/queue/scheduling은 그대로 보존해야 합니다.`);
    }
    for (const [target, expected] of [
      [oldLane.current, proof.oldTargets?.[key]],
      [newLane.current, proof.newTargets?.[key]],
    ]) {
      if (!expected || target.releaseId !== expected.batchTargetReleaseId
        || target.workerSourceGitSha !== expected.workerSourceGitSha
        || target.imageUri.split("@")[1] !== expected.workerImageDigest
        || target.jobDefinitionArn !== expected.jobDefinitionArn
        || target.jobQueueArn !== expected.jobQueueArn
        || target.renderSpecVersion !== 4 || target.captionRenderSpecVersion !== 4
        || target.fontManifestSha256 !== proof.fontManifestSha256) {
        throw new Error(`successor ${key}가 finalized DB target 증거와 다릅니다.`);
      }
    }
  }
  return newRegistry;
}

export function validateSuccessorSnapshot(snapshot, context, { requireFence = false } = {}) {
  if (!snapshot || !snapshot.proof || !snapshot.state || !snapshot.flags) {
    throw new Error("successor DB snapshot이 완전하지 않습니다.");
  }
  const { proof, state, flags, operation } = snapshot;
  const promoted = state.stableReleaseId === context.successorReleaseId;
  if (!promoted && (state.stableReleaseId !== context.predecessorReleaseId
    || state.candidateReleaseId !== context.successorReleaseId)) {
    throw new Error("successor 현재 stable/candidate가 달라졌습니다.");
  }
  if (proof.compatibleSuccessor?.predecessorReleaseId !== context.predecessorReleaseId
    || !HASH.test(proof.fontManifestSha256 || "") || !SHA.test(proof.sourceGitSha || "")
    || flags.publicEnabled !== true || flags.runtimeEnabled !== true || flags.killSwitch !== false
    || ![5, 25, 100].includes(flags.rolloutPercent)) {
    throw new Error("successor 공개 상태 또는 기록된 predecessor가 다릅니다.");
  }
  validateSuccessorRegistryTransition(context.oldRegistry, context.newRegistry, proof);
  if (operation && operation.phase !== "active") {
    if (operation.version !== 1 || !UUID.test(operation.id || "")
      || operation.head !== context.head
      || operation.predecessorReleaseId !== context.predecessorReleaseId
      || operation.successorReleaseId !== context.successorReleaseId
      || operation.oldRegistrySha256 !== context.oldRegistrySha256
      || operation.newRegistrySha256 !== context.newRegistrySha256
      || exactJson(operation.oldRegistry) !== exactJson(context.oldRegistry)
      || exactJson(operation.newRegistry) !== exactJson(context.newRegistry)
      || exactJson(operation.flags) !== exactJson(flags)
      || exactJson(operation.proof) !== exactJson(proof)) {
      throw new Error("successor durable fence의 불변 identity가 다릅니다.");
    }
  } else if (requireFence) {
    throw new Error("successor durable fence가 활성 상태가 아닙니다.");
  }
  return snapshot;
}

export async function withProjectSuccessorDatabase(callback, environment = process.env) {
  const sql = postgres(requireProductionDatabaseUrl(environment), {
    max: 1, prepare: false, connect_timeout: 15, idle_timeout: 5,
    connection: { application_name: "easycut-project-target-successor", statement_timeout: 15_000 },
    transform: postgres.camel,
  });
  try { return await sql.begin(callback); } finally { await sql.end({ timeout: 5 }); }
}

const FUNCTIONS = {
  _project_target_successor_contract: true,
  _project_target_successor_flags: true,
  _assert_project_successor_registry: false,
  project_target_successor_drain: true,
  begin_project_target_successor: true,
  transition_project_target_successor: true,
  editor_target_successor_admin_release: true,
  enforce_project_target_successor_admission: false,
};

export async function verifyProjectSuccessorSchema(tx) {
  const sources = new Map();
  const sourceFor = (functionName) => {
    const migration = FUNCTION_MIGRATIONS[functionName] || SUCCESSOR_MIGRATION;
    if (!sources.has(migration)) sources.set(migration, fs.readFileSync(migration, "utf8"));
    return sources.get(migration);
  };
  const rows = await tx`
    select p.proname,p.prosrc,p.prosecdef,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
      exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where acl.grantee<>p.proowner and (acl.grantee<>(select oid from pg_roles where rolname='service_role')
          or acl.privilege_type<>'EXECUTE' or acl.is_grantable)) as unexpected_grant
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='shorts_mvp' and p.proname=any(${Object.keys(FUNCTIONS)})
  `;
  if (rows.length !== Object.keys(FUNCTIONS).length) throw new Error("successor additive SQL 함수가 누락됐습니다.");
  for (const row of rows) {
    const source = sourceFor(row.proname);
    const body = new RegExp(`create or replace function shorts_mvp\\.${row.proname}\\([\\s\\S]*?\\nas \\$\\$\\n([\\s\\S]*?)\\n\\$\\$;`, "i").exec(source)?.[1];
    const normalized = (text) => String(text || "").trim().replace(/\s+/gu, " ");
    if (!body || normalized(body) !== normalized(row.prosrc) || row.prosecdef !== true
      || row.serviceExecute !== FUNCTIONS[row.proname] || row.unexpectedGrant !== false) {
      throw new Error(`successor 함수 본문/ACL이 exact additive migration과 다릅니다: ${row.proname}`);
    }
  }
  const trigger = await tx`
    select tgenabled,tgtype,pg_get_triggerdef(oid) as definition from pg_trigger
    where tgrelid='shorts_mvp.video_jobs'::regclass
      and tgname='video_jobs_project_target_successor_admission' and not tgisinternal
  `;
  if (trigger.length !== 1 || trigger[0].tgenabled !== "O" || trigger[0].tgtype !== 7
    || !trigger[0].definition.includes("BEFORE INSERT ON shorts_mvp.video_jobs")
    || !trigger[0].definition.endsWith("shorts_mvp.enforce_project_target_successor_admission()")) {
    throw new Error("구웹 INSERT용 successor durable fence trigger가 올바르지 않습니다.");
  }
}

export async function readProjectSuccessorSnapshot(tx, context, options = {}) {
  const rows = await tx`
    select stable_release_id,candidate_release_id,
      render_v4_target_successor::text as operation
    from shorts_mvp.editor_release_state where singleton for share
  `;
  const proof = await tx`select shorts_mvp._project_target_successor_contract(
    ${context.predecessorReleaseId}::uuid,${context.successorReleaseId}::uuid,${options.allowPromoted === true}
  )::text as value`;
  const flags = await tx`select shorts_mvp._project_target_successor_flags()::text as value`;
  // postgres.camel transforms JSONB object keys recursively, including exact
  // lane names such as legacy_project and source_range. Preserve these signed
  // contract keys as text across both the controller's and lease caller's DB
  // connections; ordinary SQL column names may still use camelCase.
  const decode = (value) => {
    if (typeof value !== "string") throw new Error("successor exact JSON text가 누락됐습니다.");
    return JSON.parse(value);
  };
  return validateSuccessorSnapshot({ state: rows[0],
    operation: rows[0]?.operation == null ? null : decode(rows[0].operation),
    proof: decode(proof[0]?.value), flags: decode(flags[0]?.value) }, context, options);
}

export async function assertProjectSuccessorLease(tx, context, { requireDrained = false } = {}) {
  if (!context || !UUID.test(context.adminUserId || "")) throw new Error("명시적인 successor lease identity가 필요합니다.");
  const admin = await tx`select id from shorts_mvp.app_users
    where id=${context.adminUserId}::uuid and is_admin and withdrawn_at is null for share`;
  if (admin.length !== 1) throw new Error("successor 실제 관리자 권한이 필요합니다.");
  const snapshot = await readProjectSuccessorSnapshot(tx, context, { requireFence: true });
  if (snapshot.operation.phase !== "fenced") throw new Error("successor AWS 변경 전 접수를 fenced 상태로 닫아야 합니다.");
  if (requireDrained) {
    const drain = (await tx`select shorts_mvp.project_target_successor_drain() as value`)[0]?.value;
    if (!drain || Object.keys(drain).length !== 4 || Object.values(drain).some((value) => Number(value) !== 0)) {
      throw new Error(`successor 미제출 작업/outbox/claim 또는 더 오래된 실행 작업이 남았습니다: ${JSON.stringify(drain)}`);
    }
  }
  return snapshot;
}

export async function beginProjectSuccessor(context, environment = process.env) {
  return withProjectSuccessorDatabase(async (tx) => {
    await verifyProjectSuccessorSchema(tx);
    const snapshot = await readProjectSuccessorSnapshot(tx, context);
    if (snapshot.operation?.phase && snapshot.operation.phase !== "active") return snapshot.operation;
    const rows = await tx`select shorts_mvp.begin_project_target_successor(
      ${context.predecessorReleaseId}::uuid,${context.successorReleaseId}::uuid,
      ${tx.json({ base: context.base, head: context.head, oldRegistry: context.oldRegistry,
        newRegistry: context.newRegistry, oldRegistrySha256: context.oldRegistrySha256,
        newRegistrySha256: context.newRegistrySha256, oldRuntime: context.oldRuntime })},${context.adminUserId}::uuid
    ) as value`;
    return rows[0].value;
  }, environment);
}

export async function transitionProjectSuccessor(context, action, runtime, environment = process.env) {
  return withProjectSuccessorDatabase(async (tx) => {
    await verifyProjectSuccessorSchema(tx);
    const snapshot = action === "fence" ? {
      operation: (await tx`select render_v4_target_successor as value
        from shorts_mvp.editor_release_state where singleton for share`)[0]?.value,
    } : await readProjectSuccessorSnapshot(tx, context, { requireFence: true, allowPromoted: true });
    const rows = await tx`select shorts_mvp.transition_project_target_successor(
      ${snapshot.operation.id}::uuid,${action},${tx.json(runtime)},${context.adminUserId}::uuid
    ) as value`;
    return rows[0].value;
  }, environment);
}

export function successorDefinitionContract(definition, { removeReleaseIdentity = false } = {}) {
  const container = structuredClone(definition.containerProperties || {});
  delete container.image;
  const omitted = new Set(["WORKER_IMAGE_TAG", "WORKER_IMAGE_DIGEST"]);
  if (removeReleaseIdentity) for (const name of ["EDITOR_RELEASE_GIT_SHA", "EDITOR_RENDER_SPEC_VERSION",
    "EDITOR_CAPTION_RENDER_SPEC_VERSION", "EDITOR_FONT_MANIFEST_SHA256"]) omitted.add(name);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  container.environment = (container.environment || []).filter((item) => !omitted.has(item.name))
    .sort((a, b) => compare(String(a.name || ""), String(b.name || "")) || compare(String(a.value || ""), String(b.value || "")));
  if (container.secrets) container.secrets.sort((a, b) => compare(String(a.name || ""), String(b.name || ""))
    || compare(String(a.valueFrom || ""), String(b.valueFrom || "")));
  if (container.resourceRequirements) container.resourceRequirements.sort((a, b) => compare(String(a.type), String(b.type)));
  return { type: definition.type ?? null, parameters: definition.parameters || {}, containerProperties: container,
    platformCapabilities: [...(definition.platformCapabilities || [])].sort(), retryStrategy: definition.retryStrategy || {},
    timeout: definition.timeout || {}, propagateTags: Boolean(definition.propagateTags) };
}

export function successorDefinitionHash(definition) {
  // Match Python json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=True).
  const ascii = exactJson(successorDefinitionContract(definition)).replace(/[\u007f-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return successorHash(ascii);
}

export function validateSuccessorDefinitions(definitions, context, proof) {
  const byArn = new Map(definitions.map((row) => [row.jobDefinitionArn, row]));
  const oldEditor = proof.compatibleSuccessor.editor.jobDefinitionArn;
  const pairs = [[oldEditor, proof.editorJobDefinitionArn, proof.compatibleSuccessor.editor.contractSha256]];
  for (const key of KEYS) pairs.push([proof.oldTargets[key].jobDefinitionArn,
    proof.newTargets[key].jobDefinitionArn, proof.compatibleSuccessor.projectTargets[key].contractSha256]);
  for (const [oldArn, newArn, contractHash] of pairs) {
    const old = byArn.get(oldArn); const next = byArn.get(newArn);
    if (!old || !next || old.status !== "ACTIVE" || next.status !== "ACTIVE"
      || successorDefinitionHash(old) !== contractHash
      || exactJson(successorDefinitionContract(old, { removeReleaseIdentity: true }))
        !== exactJson(successorDefinitionContract(next, { removeReleaseIdentity: true }))) {
      throw new Error("successor 실제 AWS CPU/메모리/프록시/토큰/역할/재시도 계약이 predecessor와 다릅니다.");
    }
    for (const [row, source, digest] of [[old, proof.compatibleSuccessor.sourceGitSha, proof.compatibleSuccessor.workerImageDigest],
      [next, proof.sourceGitSha, proof.workerImageDigest]]) {
      const expected = { EDITOR_RELEASE_GIT_SHA: source, WORKER_IMAGE_DIGEST: digest,
        EDITOR_RENDER_SPEC_VERSION: "4", EDITOR_CAPTION_RENDER_SPEC_VERSION: "4",
        EDITOR_FONT_MANIFEST_SHA256: proof.fontManifestSha256 };
      const env = row.containerProperties?.environment || [];
      if (!String(row.containerProperties?.image || "").endsWith(`@${digest}`)
        || Object.entries(expected).some(([name, value]) => env.filter((item) => item.name === name && item.value === value).length !== 1
          || env.filter((item) => item.name === name).length !== 1)) {
        throw new Error("successor 실제 AWS source/image/font identity가 다릅니다.");
      }
    }
  }
  for (const key of KEYS) {
    if (byArn.get(proof.newTargets[key].jobDefinitionArn)?.containerProperties?.image
      !== context.newRegistry.lanes[key].current.imageUri
      || byArn.get(proof.oldTargets[key].jobDefinitionArn)?.containerProperties?.image
      !== context.oldRegistry.lanes[key].current.imageUri) throw new Error("successor AWS image URI가 registry와 다릅니다.");
  }
  return successorHash(exactJson(pairs.map(([before, after, hash]) => ({ before, after, hash }))));
}

export function successorAwsJson(args, region) {
  return JSON.parse(execFileSync("aws", [...args, "--region", region, "--output", "json"],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
}

export function verifySuccessorAwsDefinitions(context, proof, region, aws = successorAwsJson) {
  const arns = [...new Set([proof.compatibleSuccessor.editor.jobDefinitionArn, proof.editorJobDefinitionArn,
    ...KEYS.flatMap((key) => [proof.oldTargets[key].jobDefinitionArn, proof.newTargets[key].jobDefinitionArn])])];
  const definitions = aws(["batch", "describe-job-definitions", "--job-definitions", ...arns], region).jobDefinitions || [];
  const hash = validateSuccessorDefinitions(definitions, context, proof);
  const queues = [...new Set(KEYS.map((key) => context.newRegistry.lanes[key].current.jobQueueArn))];
  const actual = aws(["batch", "describe-job-queues", "--job-queues", ...queues], region).jobQueues || [];
  if (actual.length !== queues.length || new Set(actual.map((queue) => queue.jobQueueArn)).size !== queues.length
    || actual.some((queue) => !queues.includes(queue.jobQueueArn) || queue.state !== "ENABLED" || queue.status !== "VALID"
      || KEYS.some((key) => context.newRegistry.lanes[key].current.jobQueueArn === queue.jobQueueArn
        && Boolean(queue.schedulingPolicyArn) !== (context.newRegistry.lanes[key].schedulingMode === "fair_share")))) {
    throw new Error("successor 기존 Batch queue가 ready 상태가 아닙니다.");
  }
  return successorHash(exactJson({ definitions: hash, queues: actual.map((queue) => ({
    arn: queue.jobQueueArn, schedulingPolicyArn: queue.schedulingPolicyArn || null,
    computeEnvironmentOrder: queue.computeEnvironmentOrder,
  })).sort((left, right) => left.arn < right.arn ? -1 : left.arn > right.arn ? 1 : 0) }));
}

export function validateSuccessorLambdaEnvironment(functionName, variables, registry) {
  const environment = variables || {};
  if (environment.PROJECT_TARGET_REGISTRY_PATH !== "/var/task/production-project-targets.json"
    || environment.PROJECT_TARGET_REGISTRY_JSON) throw new Error("successor Lambda registry 경로/inline override가 다릅니다.");
  if (functionName.includes("registrar")) return;
  if (environment.PROJECT_TARGET_REGISTRY_REQUIRED !== "true") throw new Error("successor submitter registry가 필수가 아닙니다.");
  for (const [key, prefix] of Object.entries(PROJECT_TARGET_LANES)) {
    const target = registry.lanes[key].current;
    if (environment[`${prefix}_JOB_DEFINITION_ARN`] !== target.jobDefinitionArn
      || environment[`${prefix}_BATCH_QUEUE_ARN`] !== target.jobQueueArn) {
      throw new Error(`successor submitter ${key} 실제 환경이 registry와 다릅니다.`);
    }
    if ((environment[`${prefix}_PREVIOUS_JOB_DEFINITION_ARN`] || null)
      !== (registry.lanes[key].previous?.jobDefinitionArn || null)) {
      throw new Error(`successor submitter ${key} previous 환경이 registry와 다릅니다.`);
    }
  }
}

export async function readSuccessorLambdaRuntime(functionName, registry, region, { aws = successorAwsJson, fetcher = fetch, verifySource = true } = {}) {
  const response = aws(["lambda", "get-function", "--function-name", functionName], region);
  validateSuccessorLambdaEnvironment(functionName, response.Configuration?.Environment?.Variables, registry);
  if (response.Configuration?.State !== "Active" || response.Configuration?.LastUpdateStatus !== "Successful") {
    throw new Error("successor Lambda가 안정된 실행 상태가 아닙니다.");
  }
  const downloaded = await fetcher(response.Code.Location, { signal: AbortSignal.timeout(30_000) });
  if (!downloaded.ok) throw new Error("successor Lambda code 읽기에 실패했습니다.");
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  if (bytes.length > 16 * 1024 * 1024 || crypto.createHash("sha256").update(bytes).digest("base64") !== response.Configuration.CodeSha256) {
    throw new Error("successor 실제 Lambda code checksum이 다릅니다.");
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shorts-successor-lambda-"));
  try {
    const archive = path.join(directory, "code.zip");
    fs.writeFileSync(archive, bytes);
    const read = (name) => execFileSync("unzip", ["-p", archive, name], { timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
    if (exactJson(JSON.parse(read("production-project-targets.json").toString("utf8"))) !== exactJson(registry)) {
      throw new Error("successor 실제 Lambda registry가 exact registry와 다릅니다.");
    }
    const entry = functionName.includes("registrar") ? "editor_release_registrar.py" : "batch_submitter.py";
    for (const name of verifySource ? [entry, "common.py"] : []) if (!read(name).equals(fs.readFileSync(path.join(ROOT, "infra/aws/lambda", name)))) {
      throw new Error(`successor 실제 Lambda ${name}가 검증한 exact 소스와 다릅니다.`);
    }
    return { codeSha256: successorHash(bytes), revisionId: response.Configuration.RevisionId,
      // Compare all existing environment values without ever printing them.
      environmentSha256: successorHash(exactJson(response.Configuration.Environment.Variables)) };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

export function countSuccessorActiveJobs(registry, region, aws = successorAwsJson) {
  const queues = [...new Set(KEYS.map((key) => registry.lanes[key].current.jobQueueArn))];
  const definitions = new Set(KEYS.map((key) => registry.lanes[key].current.jobDefinitionArn));
  const ids = new Set();
  for (const queue of queues) for (const status of ["SUBMITTED", "PENDING", "RUNNABLE", "STARTING", "RUNNING"]) {
    let token = "";
    const seenTokens = new Set();
    do {
      const args = ["batch", "list-jobs", "--job-queue", queue, "--job-status", status, "--max-results", "100", "--no-paginate"];
      if (token) args.push("--next-token", token);
      const response = aws(args, region);
      for (const job of response.jobSummaryList || []) {
        if (!UUID.test(job.jobId || "")) throw new Error("successor AWS active job ID가 올바르지 않습니다.");
        ids.add(job.jobId);
      }
      token = response.nextToken || "";
      if (token && (seenTokens.has(token) || seenTokens.size >= 100)) throw new Error("successor AWS active job 목록 확인이 완료되지 않았습니다.");
      seenTokens.add(token);
    } while (token);
  }
  let count = 0;
  const all = [...ids];
  for (let offset = 0; offset < all.length; offset += 100) {
    const batch = all.slice(offset, offset + 100);
    const jobs = aws(["batch", "describe-jobs", "--jobs", ...batch], region).jobs || [];
    if (jobs.length !== batch.length || new Set(jobs.map((job) => job.jobId)).size !== batch.length
      || jobs.some((job) => !batch.includes(job.jobId))) throw new Error("successor AWS active job identity 확인이 완료되지 않았습니다.");
    count += jobs.filter((job) => definitions.has(job.jobDefinition)
      && !["SUCCEEDED", "FAILED"].includes(job.status)).length;
  }
  return count;
}
