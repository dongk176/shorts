import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedProjectTargetKey,
  productionDatabaseFingerprint,
  productionDatabaseReadOnlyOptions,
  queryBatchSubmissionClaimsWithoutAwsId,
  queryNonterminalAwsBatchJobs,
  requireProductionDatabaseUrl,
  runProductionProjectTargetJobVerification,
  validateBatchSubmissionClaimsWithoutAwsId,
  validateNonterminalProjectTargetJobs,
} from "./verify-production-project-target-jobs.mjs";

const PRODUCTION_DATABASE_URL =
  "postgresql://postgres.mvcprswvfybudtopepuj:secret@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres";
const PRODUCTION_DATABASE_ENVIRONMENT = {
  DATABASE_URL: PRODUCTION_DATABASE_URL,
  PRODUCTION_DATABASE_FINGERPRINT: productionDatabaseFingerprint(
    PRODUCTION_DATABASE_URL,
  ),
};

const CURRENT_SOURCE_SHA = "a".repeat(40);
const PREVIOUS_SOURCE_SHA = "b".repeat(40);
const CURRENT_DEFINITION = "arn:aws:batch:ap-northeast-2:181651591905:job-definition/unified-aaaaaaa-current:2";
const PREVIOUS_DEFINITION = "arn:aws:batch:ap-northeast-2:181651591905:job-definition/unified-bbbbbbb-previous:1";
const CURRENT_QUEUE = "arn:aws:batch:ap-northeast-2:181651591905:job-queue/unified-current";
const PREVIOUS_QUEUE = "arn:aws:batch:ap-northeast-2:181651591905:job-queue/unified-previous";

function release(lane, generation, overrides = {}) {
  const workerSourceGitSha = generation === "previous"
    ? PREVIOUS_SOURCE_SHA
    : CURRENT_SOURCE_SHA;
  return {
    releaseId: `${lane.replaceAll("_", "-")}-${workerSourceGitSha.slice(0, 7)}-${generation}-r1`,
    workerSourceGitSha,
    imageUri: `181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-editor-releases-production@sha256:${(generation === "previous" ? "b" : "a").repeat(64)}`,
    jobDefinitionArn: `arn:aws:batch:ap-northeast-2:181651591905:job-definition/${lane}-${workerSourceGitSha.slice(0, 7)}-${generation}:1`,
    jobQueueArn: `arn:aws:batch:ap-northeast-2:181651591905:job-queue/${lane}-${generation}`,
    ...overrides,
  };
}

function registry() {
  return {
    version: 1,
    environment: "production",
    lanes: {
      legacy_project: {
        schedulingMode: "fair_share",
        current: release("legacy_project", "current"),
        previous: null,
      },
      source_range: {
        schedulingMode: "fair_share",
        current: release("source_range", "current"),
        previous: null,
      },
      elevenlabs_transcription: {
        schedulingMode: "fair_share",
        current: release("elevenlabs_transcription", "current"),
        previous: null,
      },
      subtitle_templates: {
        schedulingMode: "fair_share",
        current: release("subtitle_templates", "current"),
        previous: null,
      },
      unified_template_subtitles: {
        schedulingMode: "fifo",
        current: release("unified_template_subtitles", "current", {
          jobDefinitionArn: CURRENT_DEFINITION,
          jobQueueArn: CURRENT_QUEUE,
        }),
        previous: release("unified_template_subtitles", "previous", {
          jobDefinitionArn: PREVIOUS_DEFINITION,
          jobQueueArn: PREVIOUS_QUEUE,
          submitAsReleaseId: "unified-template-subtitles-aaaaaaa-current-r1",
        }),
      },
    },
  };
}

function job(overrides = {}) {
  const target = registry().lanes.legacy_project.current;
  return {
    id: "00000000-0000-4000-8000-000000000001",
    projectNumber: 7001,
    status: "queued",
    executionBackend: "aws_batch",
    sourceRangeSelectionEnabled: false,
    transcriptionPolicy: "openai_stable",
    subtitleTemplateId: null,
    templateSnapshot: null,
    subtitleTemplateSnapshot: null,
    batchTargetKey: "legacy_project",
    batchTargetReleaseId: target.releaseId,
    batchJobDefinition: null,
    batchJobQueue: null,
    ...overrides,
  };
}

function claim(overrides = {}) {
  const owner = job();
  const target = registry().lanes.legacy_project.current;
  return {
    ...owner,
    submissionKey: `project:${owner.id}:0`,
    claimAwsBatchJobId: null,
    claimJobDefinition: target.jobDefinitionArn,
    claimJobQueue: target.jobQueueArn,
    ...overrides,
  };
}

test("DATABASE_URL and its password-independent production fingerprint are mandatory", () => {
  assert.throws(() => requireProductionDatabaseUrl({}), /DATABASE_URL/);
  assert.throws(
    () => requireProductionDatabaseUrl({ DATABASE_URL: PRODUCTION_DATABASE_URL }),
    /PRODUCTION_DATABASE_FINGERPRINT/,
  );
  assert.equal(
    requireProductionDatabaseUrl(PRODUCTION_DATABASE_ENVIRONMENT),
    PRODUCTION_DATABASE_URL,
  );
  assert.equal(
    productionDatabaseFingerprint(PRODUCTION_DATABASE_URL.replace("secret", "rotated")),
    PRODUCTION_DATABASE_ENVIRONMENT.PRODUCTION_DATABASE_FINGERPRINT,
  );
  assert.throws(
    () => requireProductionDatabaseUrl({
      ...PRODUCTION_DATABASE_ENVIRONMENT,
      DATABASE_URL: PRODUCTION_DATABASE_URL.replace(
        "postgres.mvcprswvfybudtopepuj",
        "postgres.staging-ref",
      ),
    }),
    /고정된 운영 DB fingerprint와 다릅니다/,
  );
  const options = productionDatabaseReadOnlyOptions();
  assert.equal(options.connection.default_transaction_read_only, true);
  assert.equal(options.max, 1);
  assert.ok(options.connection.statement_timeout > 0);
});

test("the production query is scoped to nonterminal AWS Batch rows and is read-only", async () => {
  const calls = [];
  const fakeSql = (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return [];
  };
  await queryNonterminalAwsBatchJobs(fakeSql);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, []);
  assert.match(calls[0].text, /from shorts_mvp\.video_jobs/i);
  assert.match(calls[0].text, /execution_backend\s*=\s*'aws_batch'/i);
  assert.match(calls[0].text, /status not in \('completed', 'failed', 'expired', 'deleted'\)/i);
  assert.doesNotMatch(
    calls[0].text,
    /\b(insert|update|delete|truncate|alter|drop|create|merge|call|copy)\b/i,
  );
});

test("the claim query evaluates every no-ID claim in the same read-only snapshot", async () => {
  const calls = [];
  const fakeSql = (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return [];
  };
  await queryBatchSubmissionClaimsWithoutAwsId(fakeSql);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, []);
  assert.match(calls[0].text, /from shorts_mvp\.batch_submission_claims claim/i);
  assert.match(calls[0].text, /left join shorts_mvp\.video_jobs job/i);
  assert.match(calls[0].text, /claim\.aws_batch_job_id is null/i);
  assert.doesNotMatch(calls[0].text, /status not in/i);
  assert.doesNotMatch(
    calls[0].text,
    /\b(insert|update|delete|truncate|alter|drop|create|merge|call|copy)\b/i,
  );
});

test("semantic lane selection matches unified, admin subtitle, transcription, range, and legacy precedence", () => {
  assert.equal(expectedProjectTargetKey(job()), "legacy_project");
  assert.equal(expectedProjectTargetKey(job({ sourceRangeSelectionEnabled: true })), "source_range");
  assert.equal(expectedProjectTargetKey(job({
    transcriptionPolicy: "elevenlabs_primary_openai_fallback",
  })), "elevenlabs_transcription");
  assert.equal(expectedProjectTargetKey(job({
    subtitleTemplateId: "pop",
    transcriptionPolicy: "elevenlabs_primary_openai_fallback",
  })), "subtitle_templates");
  assert.equal(expectedProjectTargetKey(job({
    subtitleTemplateId: "pop",
    transcriptionPolicy: "elevenlabs_primary_openai_fallback",
    templateSnapshot: { config: { schemaVersion: 5 } },
    subtitleTemplateSnapshot: { origin: "unified-template-v5" },
  })), "unified_template_subtitles");
  assert.throws(() => expectedProjectTargetKey(job({
    templateSnapshot: { config: { schemaVersion: 5 } },
    subtitleTemplateSnapshot: { origin: "wrong" },
    transcriptionPolicy: "elevenlabs_primary_openai_fallback",
  })), /출처/);
});

test("accepts logical current and mapped previous releases only with their effective raw target", () => {
  const value = registry();
  const lane = value.lanes.unified_template_subtitles;
  const common = {
    transcriptionPolicy: "elevenlabs_primary_openai_fallback",
    templateSnapshot: { config: { schemaVersion: 5 } },
    subtitleTemplateSnapshot: { origin: "unified-template-v5" },
    batchTargetKey: "unified_template_subtitles",
  };
  const result = validateNonterminalProjectTargetJobs([
    job({
      ...common,
      batchTargetReleaseId: lane.current.releaseId,
      batchJobDefinition: null,
      batchJobQueue: null,
    }),
    job({
      ...common,
      id: "00000000-0000-4000-8000-000000000002",
      batchTargetReleaseId: lane.previous.releaseId,
      awsBatchJobId: "11111111-2222-3333-4444-555555555552",
      batchJobDefinition: lane.current.jobDefinitionArn,
      batchJobQueue: lane.current.jobQueueArn,
    }),
  ], value);
  assert.deepEqual(result, { checked: 2, issues: [] });
});

test("rejects raw targets that do not match the logical release's effective submit target", () => {
  const value = registry();
  const lane = value.lanes.unified_template_subtitles;
  const common = {
    transcriptionPolicy: "elevenlabs_primary_openai_fallback",
    templateSnapshot: { config: { schemaVersion: 5 } },
    subtitleTemplateSnapshot: { origin: "unified-template-v5" },
    batchTargetKey: "unified_template_subtitles",
    awsBatchJobId: "11111111-2222-3333-4444-555555555553",
    batchJobDefinition: lane.previous.jobDefinitionArn,
    batchJobQueue: lane.previous.jobQueueArn,
  };
  const result = validateNonterminalProjectTargetJobs([
    job({
      ...common,
      batchTargetReleaseId: lane.current.releaseId,
    }),
    job({
      ...common,
      id: "00000000-0000-4000-8000-000000000003",
      batchTargetReleaseId: lane.previous.releaseId,
    }),
  ], value);
  assert.deepEqual(result.issues.map(({ code }) => code), [
    "raw_target_does_not_match_effective_release",
    "raw_target_does_not_match_effective_release",
  ]);
});

test("rejects a submitted Batch ID without its raw definition and queue provenance", () => {
  const value = registry();
  const result = validateNonterminalProjectTargetJobs([
    job({
      awsBatchJobId: "11111111-2222-3333-4444-555555555555",
      batchJobDefinition: null,
      batchJobQueue: null,
    }),
  ], value);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "batch_id_without_raw_target");
});

test("accepts the current release exact raw target before Batch submission", () => {
  const value = registry();
  const current = value.lanes.legacy_project.current;
  const result = validateNonterminalProjectTargetJobs([
    job({
      awsBatchJobId: null,
      batchJobDefinition: current.jobDefinitionArn,
      batchJobQueue: current.jobQueueArn,
    }),
  ], value);
  assert.deepEqual(result, { checked: 1, issues: [] });
});

test("rejects mismatched, incomplete, and non-current raw targets before submission", () => {
  const value = registry();
  const current = value.lanes.legacy_project.current;
  const unified = value.lanes.unified_template_subtitles;
  const unifiedContract = {
    transcriptionPolicy: "elevenlabs_primary_openai_fallback",
    templateSnapshot: { config: { schemaVersion: 5 } },
    subtitleTemplateSnapshot: { origin: "unified-template-v5" },
    batchTargetKey: "unified_template_subtitles",
    batchTargetReleaseId: unified.previous.releaseId,
  };
  const result = validateNonterminalProjectTargetJobs([
    job({
      batchJobDefinition: current.jobDefinitionArn,
      batchJobQueue: value.lanes.source_range.current.jobQueueArn,
    }),
    job({
      id: "00000000-0000-4000-8000-000000000006",
      batchJobDefinition: current.jobDefinitionArn,
      batchJobQueue: null,
    }),
    job({
      ...unifiedContract,
      id: "00000000-0000-4000-8000-000000000007",
      batchJobDefinition: unified.current.jobDefinitionArn,
      batchJobQueue: unified.current.jobQueueArn,
    }),
  ], value);
  assert.deepEqual(result.issues.map(({ code }) => code), [
    "raw_target_does_not_match_effective_release",
    "incomplete_raw_target",
    "raw_target_without_batch_id",
  ]);
});

test("legacy rows require an exact raw pair for their semantic lane without mutation", () => {
  const value = registry();
  const legacy = value.lanes.legacy_project.current;
  const row = job({
    batchTargetKey: null,
    batchTargetReleaseId: null,
    batchJobDefinition: legacy.jobDefinitionArn,
    batchJobQueue: legacy.jobQueueArn,
  });
  const original = structuredClone(row);
  assert.deepEqual(
    validateNonterminalProjectTargetJobs([row], value),
    { checked: 1, issues: [] },
  );
  assert.deepEqual(row, original);

  const missing = validateNonterminalProjectTargetJobs([{
    ...row,
    batchJobDefinition: null,
    batchJobQueue: null,
  }], value);
  assert.equal(missing.issues[0].code, "legacy_raw_target_missing");
});

test("rejects semantic lane, release, and raw ARN mismatches", () => {
  const value = registry();
  const current = value.lanes.legacy_project.current;
  const cases = [
    job({ batchTargetKey: "source_range" }),
    job({ batchTargetReleaseId: "legacy-project-unknown-r1" }),
    job({
      awsBatchJobId: "11111111-2222-3333-4444-555555555554",
      batchJobDefinition: current.jobDefinitionArn,
      batchJobQueue: "",
    }),
    job({
      awsBatchJobId: "11111111-2222-3333-4444-555555555555",
      batchJobDefinition: value.lanes.source_range.current.jobDefinitionArn,
      batchJobQueue: value.lanes.source_range.current.jobQueueArn,
    }),
  ];
  const result = validateNonterminalProjectTargetJobs(cases, value);
  assert.deepEqual(
    result.issues.map(({ code }) => code),
    [
      "semantic_lane_mismatch",
      "release_outside_registry",
      "incomplete_raw_target",
      "raw_target_does_not_match_effective_release",
    ],
  );
});

test("checks every no-ID claim and rejects incomplete or orphan target provenance", () => {
  const value = registry();
  const targetlessLegacy = claim({
    submissionKey: "prepare:legacy-without-target",
    id: null,
    claimJobDefinition: null,
    claimJobQueue: null,
  });
  const incomplete = claim({
    submissionKey: "prepare:incomplete",
    id: null,
    claimJobQueue: null,
  });
  const orphan = claim({
    submissionKey: "project:00000000-0000-4000-8000-000000000099:0",
    id: null,
  });
  const result = validateBatchSubmissionClaimsWithoutAwsId([
    targetlessLegacy,
    incomplete,
    orphan,
  ], value);
  assert.equal(result.checked, 3);
  assert.deepEqual(result.issues.map(({ code }) => code), [
    "incomplete_claim_target",
    "project_claim_owner_missing",
  ]);
});

test("blocks an old claimed target when candidate submit-as changes, but accepts self-preservation", () => {
  const value = registry();
  const lane = value.lanes.unified_template_subtitles;
  const owner = {
    transcriptionPolicy: "elevenlabs_primary_openai_fallback",
    templateSnapshot: { config: { schemaVersion: 5 } },
    subtitleTemplateSnapshot: { origin: "unified-template-v5" },
    batchTargetKey: "unified_template_subtitles",
    batchTargetReleaseId: lane.previous.releaseId,
  };
  const oldClaim = claim({
    ...owner,
    claimJobDefinition: lane.previous.jobDefinitionArn,
    claimJobQueue: lane.previous.jobQueueArn,
  });
  assert.deepEqual(
    validateBatchSubmissionClaimsWithoutAwsId([oldClaim], value)
      .issues.map(({ code }) => code),
    ["project_claim_target_mismatch"],
  );

  delete lane.previous.submitAsReleaseId;
  assert.deepEqual(
    validateBatchSubmissionClaimsWithoutAwsId([oldClaim], value),
    { checked: 1, issues: [] },
  );
});

test("accepts a complete no-ID project claim only for its effective release pair", () => {
  const value = registry();
  const lane = value.lanes.unified_template_subtitles;
  const result = validateBatchSubmissionClaimsWithoutAwsId([
    claim(),
    claim({
      transcriptionPolicy: "elevenlabs_primary_openai_fallback",
      templateSnapshot: { config: { schemaVersion: 5 } },
      subtitleTemplateSnapshot: { origin: "unified-template-v5" },
      batchTargetKey: "unified_template_subtitles",
      batchTargetReleaseId: lane.previous.releaseId,
      claimJobDefinition: lane.current.jobDefinitionArn,
      claimJobQueue: lane.current.jobQueueArn,
    }),
  ], value);
  assert.deepEqual(result, { checked: 2, issues: [] });
});

test("live runner never writes and always closes its read-only connection", async () => {
  const calls = { connected: null, transaction: "", queries: [], ended: 0 };
  const rows = [job()];
  const connect = (url, options) => {
    calls.connected = { url, options };
    const sql = (strings) => {
      const query = strings.join("");
      calls.queries.push(query);
      return /batch_submission_claims/i.test(query) ? [] : rows;
    };
    sql.begin = async (mode, callback) => {
      calls.transaction = mode;
      return callback(sql);
    };
    sql.end = async () => { calls.ended += 1; };
    return sql;
  };
  const result = await runProductionProjectTargetJobVerification({
    environment: PRODUCTION_DATABASE_ENVIRONMENT,
    registry: registry(),
    connect,
  });
  assert.deepEqual(result, { checked: 1, checkedClaims: 0, issues: [] });
  assert.equal(calls.connected.options.connection.default_transaction_read_only, true);
  assert.equal(calls.transaction, "read only");
  assert.equal(calls.queries.length, 2);
  assert.doesNotMatch(
    calls.queries.join("\n"),
    /\b(insert|update|delete|truncate|alter|drop)\b/i,
  );
  assert.equal(calls.ended, 1);
});

test("live runner fails closed on an unknown job target and still closes", async () => {
  let ended = 0;
  const connect = () => {
    const sql = (strings) => (
      /batch_submission_claims/i.test(strings.join(""))
        ? []
        : [job({ batchTargetReleaseId: "legacy-project-unknown-r1" })]
    );
    sql.begin = async (mode, callback) => {
      assert.equal(mode, "read only");
      return callback(sql);
    };
    sql.end = async () => { ended += 1; };
    return sql;
  };
  await assert.rejects(
    runProductionProjectTargetJobVerification({
      environment: PRODUCTION_DATABASE_ENVIRONMENT,
      registry: registry(),
      connect,
    }),
    /target 정합성이 깨졌습니다/,
  );
  assert.equal(ended, 1);
});
