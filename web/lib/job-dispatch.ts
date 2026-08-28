import { createHash } from "node:crypto";

const TARGET_RELEASE_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const JOB_DEFINITION_ARN =
  /^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition\/[^:]+:[1-9][0-9]*$/;
const JOB_QUEUE_ARN =
  /^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-queue\/[^/]+$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const FONT_MANIFEST_SHA256 = /^[0-9a-f]{64}$/;

export type ProjectDispatchV4Capability = {
  renderSpecVersion: 4;
  captionRenderSpecVersion: 4;
  fontManifestSha256: string;
};

export type ProjectDispatchTarget = {
  targetKey:
    | "legacy_project"
    | "source_range"
    | "elevenlabs_transcription"
    | "subtitle_templates"
    | "unified_template_subtitles";
  releaseId: string;
  workerSourceGitSha: string;
  workerImageDigest: string;
  jobDefinitionArn: string;
  jobQueueArn: string;
  v4Capability: ProjectDispatchV4Capability | null;
};

function requiredReleaseId(name: string) {
  const value = process.env[name]?.trim() || "";
  if (!TARGET_RELEASE_ID.test(value)) {
    throw new Error(`${name} 환경변수가 정확한 배포 ID로 설정되지 않았습니다.`);
  }
  return value;
}

function requiredArn(name: string, pattern: RegExp) {
  const value = process.env[name]?.trim() || "";
  if (!pattern.test(value)) {
    throw new Error(`${name} 환경변수가 정확한 AWS ARN으로 설정되지 않았습니다.`);
  }
  return value;
}

function requiredIdentity(name: string, pattern: RegExp) {
  const value = process.env[name]?.trim() || "";
  if (!pattern.test(value)) {
    throw new Error(`${name} 환경변수가 정확한 릴리스 identity로 설정되지 않았습니다.`);
  }
  return value;
}

function optionalV4Capability(prefix: string): ProjectDispatchV4Capability | null {
  const values = [
    process.env[`${prefix}_RENDER_SPEC_VERSION`]?.trim() || "",
    process.env[`${prefix}_CAPTION_RENDER_SPEC_VERSION`]?.trim() || "",
    process.env[`${prefix}_FONT_MANIFEST_SHA256`]?.trim() || "",
  ];
  const present = values.filter(Boolean).length;
  if (present === 0) return null;
  if (
    present !== 3
    || values[0] !== "4"
    || values[1] !== "4"
    || !FONT_MANIFEST_SHA256.test(values[2])
  ) {
    throw new Error(`${prefix} v4 capability 환경변수가 완전한 4/4/hash가 아닙니다.`);
  }
  return {
    renderSpecVersion: 4,
    captionRenderSpecVersion: 4,
    fontManifestSha256: values[2],
  };
}

function target(
  targetKey: ProjectDispatchTarget["targetKey"],
  prefix: string,
): ProjectDispatchTarget {
  return {
    targetKey,
    releaseId: requiredReleaseId(`${prefix}_BATCH_TARGET_RELEASE_ID`),
    workerSourceGitSha: requiredIdentity(
      `${prefix}_WORKER_SOURCE_GIT_SHA`,
      GIT_SHA,
    ),
    workerImageDigest: requiredIdentity(
      `${prefix}_WORKER_IMAGE_DIGEST`,
      IMAGE_DIGEST,
    ),
    // Dual-write the current exact pair while every deployed submitter learns
    // logical releases. New code resolves the logical release; the raw pair
    // keeps a control-plane-only rollback compatible with the prior Lambda.
    jobDefinitionArn: requiredArn(
      `${prefix}_JOB_DEFINITION_ARN`,
      JOB_DEFINITION_ARN,
    ),
    jobQueueArn: requiredArn(`${prefix}_BATCH_QUEUE_ARN`, JOB_QUEUE_ARN),
    v4Capability: optionalV4Capability(prefix),
  };
}

export function legacyProjectDispatchTarget(): ProjectDispatchTarget {
  return target("legacy_project", "LEGACY_PROJECT");
}

export function sourceRangeDispatchTarget(): ProjectDispatchTarget {
  return target("source_range", "SOURCE_RANGE");
}

export function elevenLabsTranscriptionDispatchTarget(): ProjectDispatchTarget {
  return target(
    "elevenlabs_transcription",
    "ELEVENLABS_TRANSCRIPTION",
  );
}

export function subtitleTemplatesDispatchTarget(): ProjectDispatchTarget {
  return target(
    "subtitle_templates",
    "SUBTITLE_TEMPLATES",
  );
}

export function unifiedTemplateSubtitlesDispatchTarget(): ProjectDispatchTarget {
  return target(
    "unified_template_subtitles",
    "UNIFIED_TEMPLATE_SUBTITLES",
  );
}

export function projectDispatchTargetForFeatures(input: {
  usesUnifiedTemplateSubtitleCandidate: boolean;
  usesLegacySubtitleSuiteCandidate: boolean;
  transcriptionEnabled: boolean;
  sourceRangeSelectionEnabled: boolean;
}): ProjectDispatchTarget {
  if (input.usesUnifiedTemplateSubtitleCandidate) {
    return unifiedTemplateSubtitlesDispatchTarget();
  }
  if (input.usesLegacySubtitleSuiteCandidate) {
    return subtitleTemplatesDispatchTarget();
  }
  if (input.transcriptionEnabled) {
    return elevenLabsTranscriptionDispatchTarget();
  }
  if (input.sourceRangeSelectionEnabled) {
    return sourceRangeDispatchTarget();
  }
  return legacyProjectDispatchTarget();
}

export function allProjectDispatchTargets(): ProjectDispatchTarget[] {
  return [
    legacyProjectDispatchTarget(),
    sourceRangeDispatchTarget(),
    elevenLabsTranscriptionDispatchTarget(),
    subtitleTemplatesDispatchTarget(),
    unifiedTemplateSubtitlesDispatchTarget(),
  ];
}

export function projectDispatchTargetsFingerprint(
  targets: ProjectDispatchTarget[] = allProjectDispatchTargets(),
) {
  const canonical = [...targets]
    .sort((left, right) => (
      left.targetKey < right.targetKey ? -1 : left.targetKey > right.targetKey ? 1 : 0
    ))
    .map((entry) => ({
      targetKey: entry.targetKey,
      releaseId: entry.releaseId,
      workerSourceGitSha: entry.workerSourceGitSha,
      workerImageDigest: entry.workerImageDigest,
      jobDefinitionArn: entry.jobDefinitionArn,
      jobQueueArn: entry.jobQueueArn,
      v4Capability: entry.v4Capability,
    }));
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}
