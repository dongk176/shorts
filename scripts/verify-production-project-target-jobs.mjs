#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "../web/node_modules/postgres/src/index.js";
import {
  requireProductionDatabaseUrl,
} from "./production-database-identity.mjs";
export {
  productionDatabaseFingerprint,
  requireProductionDatabaseUrl,
} from "./production-database-identity.mjs";
import {
  readProductionProjectTargets,
  validateProductionProjectTargets,
} from "./production-project-targets.mjs";

const TERMINAL_JOB_STATUSES = new Set([
  "completed",
  "failed",
  "expired",
  "deleted",
]);
const SUBTITLE_TEMPLATE_IDS = new Set(["basic", "highlight", "pop"]);
const UNIFIED_TEMPLATE_SUBTITLE_ORIGIN = "unified-template-v5";
const BRAND_COLOR_VALUES = new Set([
  "#040404", "#000000", "#111111", "#1B1B1E", "#353438", "#64748B",
  "#FFFFFF", "#F3F0E9", "#E32626", "#FF4D4F", "#FF715E", "#FFB4A8",
  "#F97316", "#FFD84D", "#8BFF5A", "#16A34A", "#35E6E3", "#3B82F6",
  "#2563EB", "#A78BFA", "#DB2777",
]);

export function productionDatabaseReadOnlyOptions() {
  return {
    max: 1,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 5,
    connection: {
      application_name: "easycut-project-target-predeploy-verifier",
      default_transaction_read_only: true,
      statement_timeout: 15_000,
    },
    transform: postgres.camel,
  };
}

export async function queryNonterminalAwsBatchJobs(sql) {
  return sql`
    select
      id,
      project_number,
      status,
      execution_backend,
      source_range_selection_enabled,
      transcription_policy,
      subtitle_template_id,
      template_snapshot,
      subtitle_template_snapshot,
      batch_target_key,
      batch_target_release_id,
      batch_job_definition,
      batch_job_queue,
      aws_batch_job_id,
      project_dispatch_generation,
      created_at
    from shorts_mvp.video_jobs
    where execution_backend = 'aws_batch'
      and status not in ('completed', 'failed', 'expired', 'deleted')
    order by created_at asc, id asc
  `;
}

export async function queryBatchSubmissionClaimsWithoutAwsId(sql) {
  return sql`
    select
      claim.submission_key,
      claim.aws_batch_job_id as claim_aws_batch_job_id,
      claim.job_definition as claim_job_definition,
      claim.job_queue as claim_job_queue,
      claim.claimed_at,
      job.id,
      job.project_number,
      job.status,
      job.execution_backend,
      job.source_range_selection_enabled,
      job.transcription_policy,
      job.subtitle_template_id,
      job.template_snapshot,
      job.subtitle_template_snapshot,
      job.batch_target_key,
      job.batch_target_release_id,
      job.batch_job_definition,
      job.batch_job_queue,
      job.project_dispatch_generation
    from shorts_mvp.batch_submission_claims claim
    left join shorts_mvp.video_jobs job
      on claim.submission_key = shorts_mvp.project_submission_key(
        job.id,
        job.project_dispatch_generation,
        false
      )
      or claim.submission_key = shorts_mvp.project_submission_key(
        job.id,
        job.project_dispatch_generation,
        true
      )
    where claim.aws_batch_job_id is null
    order by claim.claimed_at asc, claim.submission_key asc
  `;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

export function expectedProjectTargetKey(job) {
  const templateSnapshot = objectValue(job.templateSnapshot);
  const templateConfig = objectValue(templateSnapshot?.config);
  const subtitleSnapshot = objectValue(job.subtitleTemplateSnapshot);
  const usesUnifiedTemplateCandidate = templateConfig?.schemaVersion === 5;
  if (usesUnifiedTemplateCandidate) {
    if (subtitleSnapshot?.origin !== UNIFIED_TEMPLATE_SUBTITLE_ORIGIN) {
      throw new Error("통합 템플릿 v5 자막 snapshot 출처가 올바르지 않습니다.");
    }
  }

  const rawSubtitleTemplateId = job.subtitleTemplateId;
  const subtitleTemplateId = rawSubtitleTemplateId == null
    ? null
    : String(rawSubtitleTemplateId);
  if (
    subtitleTemplateId !== null
    && !SUBTITLE_TEMPLATE_IDS.has(subtitleTemplateId)
  ) {
    throw new Error("자막 템플릿 ID가 허용 목록에 없습니다.");
  }
  const brandColor = typeof templateSnapshot?.brandColor === "string"
    && BRAND_COLOR_VALUES.has(templateSnapshot.brandColor)
    ? templateSnapshot.brandColor
    : null;
  const usesAdminTemplateCandidate = subtitleTemplateId !== null || brandColor !== null;
  const transcriptionPolicy = String(job.transcriptionPolicy || "openai_stable");
  if (![
    "openai_stable",
    "elevenlabs_primary_openai_fallback",
  ].includes(transcriptionPolicy)) {
    throw new Error("전사 정책이 허용 목록에 없습니다.");
  }
  if (
    (usesAdminTemplateCandidate || usesUnifiedTemplateCandidate)
    && transcriptionPolicy !== "elevenlabs_primary_openai_fallback"
  ) {
    throw new Error("자막 템플릿 작업의 단어 단위 전사 정책이 일치하지 않습니다.");
  }

  if (usesUnifiedTemplateCandidate) return "unified_template_subtitles";
  if (usesAdminTemplateCandidate) return "subtitle_templates";
  if (transcriptionPolicy === "elevenlabs_primary_openai_fallback") {
    return "elevenlabs_transcription";
  }
  if (job.sourceRangeSelectionEnabled === true) return "source_range";
  return "legacy_project";
}

function allowedLaneReleases(lane) {
  return [lane.current, lane.previous].filter(Boolean);
}

function exactRawRelease(lane, definition, queue) {
  return allowedLaneReleases(lane).find((release) => (
    release.jobDefinitionArn === definition
    && release.jobQueueArn === queue
  ));
}

function issueFor(job, code, message, expectedTargetKey = null) {
  return {
    id: String(job.id || "unknown"),
    projectNumber: job.projectNumber == null ? null : Number(job.projectNumber),
    status: String(job.status || "unknown"),
    expectedTargetKey,
    code,
    message,
  };
}

function claimIssueFor(claim, code, message, expectedTargetKey = null) {
  return {
    ...issueFor(claim, code, message, expectedTargetKey),
    submissionKey: String(claim.submissionKey || "unknown"),
  };
}

function expectedProjectClaimTarget(job, registry) {
  const expectedTargetKey = expectedProjectTargetKey(job);
  const lane = registry.lanes[expectedTargetKey];
  const targetKey = String(job.batchTargetKey || "").trim();
  const releaseId = String(job.batchTargetReleaseId || "").trim();
  const definition = String(job.batchJobDefinition || "").trim();
  const queue = String(job.batchJobQueue || "").trim();

  if (targetKey || releaseId) {
    if (!targetKey || !releaseId) {
      throw new Error("프로젝트의 논리 Batch target provenance가 완전하지 않습니다.");
    }
    if (targetKey !== expectedTargetKey) {
      throw new Error(
        `프로젝트 lane ${targetKey}가 실행 계약 lane ${expectedTargetKey}와 다릅니다.`,
      );
    }
    const logicalRelease = allowedLaneReleases(lane).find((release) => (
      release.releaseId === releaseId
    ));
    if (!logicalRelease) {
      throw new Error(
        `프로젝트 release ${releaseId}가 ${expectedTargetKey} current/previous에 없습니다.`,
      );
    }
    const effectiveReleaseId = logicalRelease.submitAsReleaseId
      || logicalRelease.releaseId;
    const effectiveRelease = allowedLaneReleases(lane).find((release) => (
      release.releaseId === effectiveReleaseId
    ));
    if (!effectiveRelease) {
      throw new Error(
        `프로젝트 release ${releaseId}의 submit-as release를 확인할 수 없습니다.`,
      );
    }
    return { expectedTargetKey, release: effectiveRelease };
  }

  if (definition || queue) {
    if (!definition || !queue) {
      throw new Error("기존 프로젝트의 raw Batch target provenance가 완전하지 않습니다.");
    }
    const storedRelease = exactRawRelease(lane, definition, queue);
    if (!storedRelease) {
      throw new Error(
        `기존 프로젝트의 raw Batch target이 ${expectedTargetKey} current/previous에 없습니다.`,
      );
    }
    const effectiveReleaseId = storedRelease.submitAsReleaseId
      || storedRelease.releaseId;
    const effectiveRelease = allowedLaneReleases(lane).find((release) => (
      release.releaseId === effectiveReleaseId
    ));
    if (!effectiveRelease) {
      throw new Error("기존 프로젝트의 submit-as release를 확인할 수 없습니다.");
    }
    return { expectedTargetKey, release: effectiveRelease };
  }

  if (expectedTargetKey !== "legacy_project") {
    throw new Error("후보 프로젝트에 immutable Batch target provenance가 없습니다.");
  }
  return { expectedTargetKey, release: lane.current };
}

export function validateBatchSubmissionClaimsWithoutAwsId(rows, registryValue) {
  const registry = validateProductionProjectTargets(registryValue);
  if (!Array.isArray(rows)) {
    throw new Error("운영 Batch 제출 claim 조회 결과가 배열이 아닙니다.");
  }
  const issues = [];

  for (const claim of rows) {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
      issues.push(claimIssueFor(
        {},
        "invalid_claim_row",
        "운영 Batch 제출 claim 행이 객체가 아닙니다.",
      ));
      continue;
    }
    if (String(claim.claimAwsBatchJobId || "").trim()) {
      issues.push(claimIssueFor(
        claim,
        "claim_query_scope_mismatch",
        "조회 결과에 AWS Batch ID가 이미 있는 claim이 포함됐습니다.",
      ));
      continue;
    }

    const definition = String(claim.claimJobDefinition || "").trim();
    const queue = String(claim.claimJobQueue || "").trim();
    const hasTarget = Boolean(definition || queue);
    if (!hasTarget) {
      // Legacy two-argument claims are not target-aware, but remain part of the
      // complete no-ID snapshot so the verifier cannot accidentally scope them
      // out when target-aware rollout begins.
      continue;
    }
    if (!definition || !queue) {
      issues.push(claimIssueFor(
        claim,
        "incomplete_claim_target",
        "AWS Batch ID 없는 claim의 definition/queue provenance가 완전하지 않습니다.",
      ));
      continue;
    }

    const submissionKey = String(claim.submissionKey || "").trim();
    if (!submissionKey.startsWith("project:")) {
      // Non-project claims have no project registry release. Their exact pair is
      // still checked above; their control-plane resources are verified by the
      // resource provenance preflight.
      continue;
    }
    if (!claim.id) {
      issues.push(claimIssueFor(
        claim,
        "project_claim_owner_missing",
        "AWS Batch ID 없는 project claim의 소유 video_jobs 행을 확인할 수 없습니다.",
      ));
      continue;
    }
    if (claim.executionBackend !== "aws_batch") {
      issues.push(claimIssueFor(
        claim,
        "project_claim_backend_mismatch",
        "target-aware project claim의 소유 작업이 AWS Batch 작업이 아닙니다.",
      ));
      continue;
    }

    let expected;
    try {
      expected = expectedProjectClaimTarget(claim, registry);
    } catch (error) {
      issues.push(claimIssueFor(
        claim,
        "project_claim_provenance_unverifiable",
        error instanceof Error ? error.message : String(error),
      ));
      continue;
    }
    if (
      definition !== expected.release.jobDefinitionArn
      || queue !== expected.release.jobQueueArn
    ) {
      issues.push(claimIssueFor(
        claim,
        "project_claim_target_mismatch",
        `AWS Batch ID 없는 claim이 프로젝트의 유효 제출 release ${expected.release.releaseId}와 일치하지 않습니다.`,
        expected.expectedTargetKey,
      ));
    }
  }

  return { checked: rows.length, issues };
}

export function validateNonterminalProjectTargetJobs(rows, registryValue) {
  const registry = validateProductionProjectTargets(registryValue);
  if (!Array.isArray(rows)) {
    throw new Error("운영 작업 조회 결과가 배열이 아닙니다.");
  }
  const issues = [];

  for (const job of rows) {
    if (!job || typeof job !== "object" || Array.isArray(job)) {
      issues.push(issueFor({}, "invalid_row", "운영 작업 행이 객체가 아닙니다."));
      continue;
    }
    if (
      job.executionBackend !== "aws_batch"
      || TERMINAL_JOB_STATUSES.has(String(job.status || ""))
    ) {
      issues.push(issueFor(
        job,
        "query_scope_mismatch",
        "조회 결과에 검증 대상이 아닌 작업이 포함됐습니다.",
      ));
      continue;
    }

    let expectedTargetKey;
    try {
      expectedTargetKey = expectedProjectTargetKey(job);
    } catch (error) {
      issues.push(issueFor(
        job,
        "invalid_execution_contract",
        error instanceof Error ? error.message : String(error),
      ));
      continue;
    }
    const lane = registry.lanes[expectedTargetKey];
    const targetKey = String(job.batchTargetKey || "").trim();
    const releaseId = String(job.batchTargetReleaseId || "").trim();
    const definition = String(job.batchJobDefinition || "").trim();
    const queue = String(job.batchJobQueue || "").trim();
    const batchJobId = String(job.awsBatchJobId || "").trim();
    const hasLogicalTarget = Boolean(targetKey || releaseId);
    const hasRawTarget = Boolean(definition || queue);

    if (hasLogicalTarget) {
      let logicalRelease = null;
      if (!targetKey || !releaseId) {
        issues.push(issueFor(
          job,
          "incomplete_logical_target",
          "논리 Batch target key/release ID가 함께 저장되지 않았습니다.",
          expectedTargetKey,
        ));
      } else if (targetKey !== expectedTargetKey) {
        issues.push(issueFor(
          job,
          "semantic_lane_mismatch",
          `저장 lane ${targetKey}가 실행 계약 lane ${expectedTargetKey}와 다릅니다.`,
          expectedTargetKey,
        ));
      } else {
        logicalRelease = allowedLaneReleases(lane).find((release) => (
          release.releaseId === releaseId
        )) || null;
        if (!logicalRelease) {
          issues.push(issueFor(
            job,
            "release_outside_registry",
            `release ${releaseId}가 ${expectedTargetKey} current/previous에 없습니다.`,
            expectedTargetKey,
          ));
        }
      }

      // A newly queued logical job has no raw submission target until the
      // submitter claims it. Once either raw field exists, follow the logical
      // release's submit-as pointer and require that exact effective pair.
      if (hasRawTarget && (!definition || !queue)) {
        issues.push(issueFor(
          job,
          "incomplete_raw_target",
          "저장된 Batch definition/queue가 완전한 쌍이 아닙니다.",
          expectedTargetKey,
        ));
      } else if (!hasRawTarget && batchJobId) {
        issues.push(issueFor(
          job,
          "batch_id_without_raw_target",
          "AWS Batch job ID가 있지만 제출 definition/queue provenance가 없습니다.",
          expectedTargetKey,
        ));
      } else if (hasRawTarget && logicalRelease) {
        const effectiveReleaseId = logicalRelease.submitAsReleaseId
          || logicalRelease.releaseId;
        const effectiveRelease = allowedLaneReleases(lane).find((release) => (
          release.releaseId === effectiveReleaseId
        ));
        if (
          !effectiveRelease
          || definition !== effectiveRelease.jobDefinitionArn
          || queue !== effectiveRelease.jobQueueArn
        ) {
          issues.push(issueFor(
            job,
            "raw_target_does_not_match_effective_release",
            `저장된 Batch ARN 쌍이 release ${releaseId}의 실제 제출 대상 ${effectiveReleaseId}와 일치하지 않습니다.`,
            expectedTargetKey,
          ));
        } else if (
          !batchJobId
          && logicalRelease.releaseId !== lane.current.releaseId
          && effectiveReleaseId !== logicalRelease.releaseId
        ) {
          issues.push(issueFor(
            job,
            "raw_target_without_batch_id",
            "AWS Batch 제출 전 이전 release는 자기 자신의 정확한 쌍으로만 보존할 수 있습니다.",
            expectedTargetKey,
          ));
        }
      }
      continue;
    }

    // Pre-registry jobs have no logical release. Do not rewrite them: accept
    // only an exact historical current/previous pair in the expected lane.
    if (!definition || !queue) {
      issues.push(issueFor(
        job,
        "legacy_raw_target_missing",
        "기존 작업에 검증 가능한 Batch definition/queue 쌍이 없습니다.",
        expectedTargetKey,
      ));
    } else if (!exactRawRelease(lane, definition, queue)) {
      issues.push(issueFor(
        job,
        "legacy_raw_target_outside_registry",
        `기존 작업의 Batch ARN 쌍이 ${expectedTargetKey} current/previous와 일치하지 않습니다.`,
        expectedTargetKey,
      ));
    }
  }

  return { checked: rows.length, issues };
}

export async function runProductionProjectTargetJobVerification({
  environment = process.env,
  registry = readProductionProjectTargets(),
  connect = postgres,
} = {}) {
  const databaseUrl = requireProductionDatabaseUrl(environment);
  const sql = connect(databaseUrl, productionDatabaseReadOnlyOptions());
  try {
    const snapshot = await sql.begin("read only", async (transaction) => ({
      jobs: await queryNonterminalAwsBatchJobs(transaction),
      claims: await queryBatchSubmissionClaimsWithoutAwsId(transaction),
    }));
    const jobResult = validateNonterminalProjectTargetJobs(snapshot.jobs, registry);
    const claimResult = validateBatchSubmissionClaimsWithoutAwsId(
      snapshot.claims,
      registry,
    );
    const result = {
      checked: jobResult.checked,
      checkedClaims: claimResult.checked,
      issues: [...jobResult.issues, ...claimResult.issues],
    };
    if (result.issues.length > 0) {
      const preview = result.issues.slice(0, 50).map((issue) => JSON.stringify(issue));
      const omitted = result.issues.length - preview.length;
      throw new Error([
        `운영 AWS Batch 비종결 작업 또는 ID 없는 제출 claim ${result.issues.length}건의 target 정합성이 깨졌습니다.`,
        ...preview,
        ...(omitted > 0 ? [`추가 ${omitted}건 생략`] : []),
      ].join("\n"));
    }
    return result;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function runCli() {
  const result = await runProductionProjectTargetJobVerification();
  process.stdout.write(
    `운영 AWS Batch 비종결 작업 target 검증 완료: ${result.checked}건, ID 없는 제출 claim ${result.checkedClaims}건\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
