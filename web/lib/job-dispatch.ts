const TARGET_RELEASE_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const JOB_DEFINITION_ARN =
  /^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition\/[^:]+:[1-9][0-9]*$/;
const JOB_QUEUE_ARN =
  /^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-queue\/[^/]+$/;

export type ProjectDispatchTarget = {
  targetKey:
    | "legacy_project"
    | "source_range"
    | "elevenlabs_transcription"
    | "subtitle_templates"
    | "unified_template_subtitles";
  releaseId: string;
  jobDefinitionArn: string;
  jobQueueArn: string;
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

function target(
  targetKey: ProjectDispatchTarget["targetKey"],
  prefix: string,
): ProjectDispatchTarget {
  return {
    targetKey,
    releaseId: requiredReleaseId(`${prefix}_BATCH_TARGET_RELEASE_ID`),
    // Dual-write the current exact pair while every deployed submitter learns
    // logical releases. New code resolves the logical release; the raw pair
    // keeps a control-plane-only rollback compatible with the prior Lambda.
    jobDefinitionArn: requiredArn(
      `${prefix}_JOB_DEFINITION_ARN`,
      JOB_DEFINITION_ARN,
    ),
    jobQueueArn: requiredArn(`${prefix}_BATCH_QUEUE_ARN`, JOB_QUEUE_ARN),
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
