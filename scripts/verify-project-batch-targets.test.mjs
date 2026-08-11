import assert from "node:assert/strict";
import test from "node:test";
import {
  compareProjectBatchTargets,
  parseEnvFile,
  projectBatchTargets,
  validateActiveBatchResources,
} from "./verify-project-batch-targets.mjs";

const targets = {
  LEGACY_PROJECT_JOB_DEFINITION_ARN:
    "arn:aws:batch:ap-northeast-2:181651591905:job-definition/legacy:28",
  LEGACY_PROJECT_BATCH_QUEUE_ARN:
    "arn:aws:batch:ap-northeast-2:181651591905:job-queue/legacy",
  SOURCE_RANGE_JOB_DEFINITION_ARN:
    "arn:aws:batch:ap-northeast-2:181651591905:job-definition/source-range:5",
  SOURCE_RANGE_BATCH_QUEUE_ARN:
    "arn:aws:batch:ap-northeast-2:181651591905:job-queue/source-range",
  ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN:
    "arn:aws:batch:ap-northeast-2:181651591905:job-definition/elevenlabs:2",
  ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN:
    "arn:aws:batch:ap-northeast-2:181651591905:job-queue/elevenlabs",
  SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN:
    "arn:aws:batch:ap-northeast-2:181651591905:job-definition/subtitles:1",
  SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN:
    "arn:aws:batch:ap-northeast-2:181651591905:job-queue/elevenlabs",
};

test("accepts the exact four web and Lambda target pairs", () => {
  assert.deepEqual(compareProjectBatchTargets(targets, { ...targets }), {
    LEGACY_PROJECT: {
      definition: targets.LEGACY_PROJECT_JOB_DEFINITION_ARN,
      queue: targets.LEGACY_PROJECT_BATCH_QUEUE_ARN,
    },
    SOURCE_RANGE: {
      definition: targets.SOURCE_RANGE_JOB_DEFINITION_ARN,
      queue: targets.SOURCE_RANGE_BATCH_QUEUE_ARN,
    },
    ELEVENLABS_TRANSCRIPTION: {
      definition: targets.ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN,
      queue: targets.ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN,
    },
    SUBTITLE_TEMPLATES: {
      definition: targets.SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN,
      queue: targets.SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN,
    },
  });
});

test("fails closed when Vercel would pin a stale worker definition", () => {
  assert.throws(
    () => compareProjectBatchTargets({
      ...targets,
      SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN:
        "arn:aws:batch:ap-northeast-2:181651591905:job-definition/subtitles-old:1",
    }, targets),
    /SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN/,
  );
});

test("rejects missing, cross-account, and shared definitions", () => {
  assert.throws(
    () => projectBatchTargets({ ...targets, SOURCE_RANGE_BATCH_QUEUE_ARN: "" }),
    /SOURCE_RANGE_BATCH_QUEUE_ARN/,
  );
  assert.throws(
    () => projectBatchTargets({
      ...targets,
      SOURCE_RANGE_BATCH_QUEUE_ARN:
        "arn:aws:batch:ap-northeast-2:000000000000:job-queue/source-range",
    }),
    /AWS 계정\/리전/,
  );
  assert.throws(
    () => projectBatchTargets({
      ...targets,
      SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN:
        targets.ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN,
    }),
    /격리되지 않았습니다/,
  );
});

test("parses quoted Vercel-style environment files without exposing other values", () => {
  assert.deepEqual(parseEnvFile([
    "# generated",
    'SOURCE_RANGE_JOB_DEFINITION_ARN="arn:aws:batch:ap-northeast-2:181651591905:job-definition/source-range:5"',
    "SOURCE_RANGE_BATCH_QUEUE_ARN='arn:aws:batch:ap-northeast-2:181651591905:job-queue/source-range'",
    "IGNORED_VALUE=secret",
  ].join("\n")), {
    SOURCE_RANGE_JOB_DEFINITION_ARN:
      "arn:aws:batch:ap-northeast-2:181651591905:job-definition/source-range:5",
    SOURCE_RANGE_BATCH_QUEUE_ARN:
      "arn:aws:batch:ap-northeast-2:181651591905:job-queue/source-range",
    IGNORED_VALUE: "secret",
  });
});

test("requires every definition and shared queue to be submit-ready", () => {
  const resolved = projectBatchTargets(targets);
  const definitions = Object.values(resolved).map(({ definition }) => ({
    jobDefinitionArn: definition,
    status: "ACTIVE",
  }));
  const queues = [...new Set(Object.values(resolved).map(({ queue }) => queue))]
    .map((queue) => ({
      jobQueueArn: queue,
      status: "VALID",
      state: "ENABLED",
    }));
  assert.doesNotThrow(
    () => validateActiveBatchResources(resolved, definitions, queues),
  );
  assert.throws(
    () => validateActiveBatchResources(
      resolved,
      definitions.filter(({ jobDefinitionArn }) => (
        jobDefinitionArn !== targets.SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN
      )),
      queues,
    ),
    /SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN is not ACTIVE/,
  );
  assert.throws(
    () => validateActiveBatchResources(
      resolved,
      definitions,
      queues.map((queue) => ({ ...queue, state: "DISABLED" })),
    ),
    /BATCH_QUEUE_ARN is not VALID\/ENABLED/,
  );
});
