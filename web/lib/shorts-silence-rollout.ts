import { createHash } from "node:crypto";
import type { ProjectDispatchTarget } from "./job-dispatch";

/** Pure admission policy. The caller must obtain this snapshot from the verified
 * server registry under the same transaction as INSERT; never from request JSON.
 * It does not grant permission, submit a job, or change an already admitted job. */
export type SilenceRolloutSnapshot = {
  enabled: boolean;
  releaseId: string;
  sourceGitSha: string;
  imageDigest: string;
  fontManifestSha256: string;
  percentage: number;
  languages: readonly string[];
  templateKinds: readonly string[];
  targets: readonly ProjectDispatchTarget[];
};
export type SilenceAdmission = {
  userId: string;
  silenceRequested: boolean;
  sourceType: "youtube" | "upload";
  language: string;
  templateKind: string;
  isExample: boolean;
  midform: boolean;
};
export type SilenceRoutingDecision =
  | { mode: "existing"; target: ProjectDispatchTarget }
  | { mode: "inline"; target: ProjectDispatchTarget; editorReleaseId: string };

const lanes = new Set(["legacy_project", "source_range", "elevenlabs_transcription",
  "subtitle_templates", "unified_template_subtitles"]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;

export function silenceRolloutBucket(userId: string, releaseId: string): number {
  return createHash("sha256").update(`silence-inline:${releaseId}:${userId}`).digest().readUInt32BE(0) % 100;
}

/** Disabling the new route or encountering an invalid snapshot keeps new
 * admissions on the existing working path, including its silence post-process.
 * Existing jobs/resumes must use their stored target, never call this selector. */
export function selectSilenceAdmissionTarget(
  request: SilenceAdmission,
  existing: ProjectDispatchTarget,
  rollout: SilenceRolloutSnapshot | null,
): SilenceRoutingDecision {
  const keep = { mode: "existing" as const, target: existing };
  // Upload stays on its original receiver until an independently verified
  // parallel receiver/capacity route is available. Never silently reroute it.
  if (!request.silenceRequested || request.sourceType !== "youtube"
    || request.isExample || request.midform || !uuid.test(request.userId)
    || !rollout?.enabled) return keep;
  if (!uuid.test(rollout.releaseId) || !/^[a-f0-9]{40}$/.test(rollout.sourceGitSha)
    || !/^sha256:[a-f0-9]{64}$/.test(rollout.imageDigest) || !hash.test(rollout.fontManifestSha256)
    || !Number.isInteger(rollout.percentage) || rollout.percentage < 0 || rollout.percentage > 100
    || !rollout.languages.includes(request.language) || !["ko", "en", "ja"].includes(request.language)
    || !rollout.templateKinds.includes(request.templateKind)
    || rollout.targets.length !== lanes.size
    || new Set(rollout.targets.map(t => t.targetKey)).size !== lanes.size) return keep;
  for (const target of rollout.targets) {
    if (!lanes.has(target.targetKey)
      || !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(target.releaseId)
      || target.workerSourceGitSha !== rollout.sourceGitSha
      || target.workerImageDigest !== rollout.imageDigest
      || target.v4Capability?.fontManifestSha256 !== rollout.fontManifestSha256
      || target.v4Capability.renderSpecVersion !== 4 || target.v4Capability.captionRenderSpecVersion !== 4
      || !/^arn:aws:batch:ap-northeast-2:181651591905:job-definition\/shorts-mvp-editor-v4-[a-z0-9-]+:[1-9][0-9]*$/.test(target.jobDefinitionArn)
      || !/^arn:aws:batch:ap-northeast-2:181651591905:job-queue\/shorts-mvp-[a-z0-9-]+$/.test(target.jobQueueArn)
      || target.jobQueueArn.endsWith("shorts-mvp-editor-test")) return keep;
  }
  const target = rollout.targets.find(t => t.targetKey === existing.targetKey);
  // Reuse the lane's established production queue; QA capacity is never public.
  if (!target || target.jobQueueArn !== existing.jobQueueArn
    || silenceRolloutBucket(request.userId, rollout.releaseId) >= rollout.percentage) return keep;
  return { mode: "inline", target: structuredClone(target), editorReleaseId: rollout.releaseId };
}
