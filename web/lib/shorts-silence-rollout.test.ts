import { describe, it, expect } from "vitest";
import { selectSilenceAdmissionTarget, silenceRolloutBucket, type SilenceAdmission, type SilenceRolloutSnapshot } from "./shorts-silence-rollout";
import type { ProjectDispatchTarget } from "./job-dispatch";
const user = "11111111-1111-4111-8111-111111111111";
const release = "22222222-2222-4222-8222-222222222222";
const queue = "arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-project-fargate-production";
const request: SilenceAdmission = { userId: user, silenceRequested: true, sourceType: "youtube", language: "ko", templateKind: "custom", isExample: false, midform: false };
function fixture() {
  const targets = ["legacy_project", "source_range", "elevenlabs_transcription", "subtitle_templates", "unified_template_subtitles"].map(targetKey => ({ targetKey, releaseId: `verified-${targetKey}`, workerSourceGitSha: "b".repeat(40), workerImageDigest: `sha256:${"c".repeat(64)}`, jobDefinitionArn: "arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-editor-v4-verified:1", jobQueueArn: queue, v4Capability: { renderSpecVersion: 4, captionRenderSpecVersion: 4, fontManifestSha256: "d".repeat(64) } })) as ProjectDispatchTarget[];
  const rollout: SilenceRolloutSnapshot = { enabled: true, releaseId: release, sourceGitSha: "b".repeat(40), imageDigest: `sha256:${"c".repeat(64)}`, fontManifestSha256: "d".repeat(64), percentage: 100, languages: ["ko", "en", "ja"], templateKinds: ["standard", "custom", "sns", "community"], targets };
  const existing = { ...targets[0], releaseId: "old-target", workerSourceGitSha: "a".repeat(40) };
  return { rollout, existing };
}
describe("silence routing without stopping existing admissions", () => {
  it.each(["ko", "en", "ja"])("selects a verified new target for %s without mutating the old one", language => {
    const { rollout, existing } = fixture(); const original = structuredClone(existing);
    const result = selectSilenceAdmissionTarget({ ...request, language }, existing, rollout);
    expect(result).toMatchObject({ mode: "inline", editorReleaseId: release });
    expect(existing).toEqual(original);
    expect(result.target).not.toBe(rollout.targets[0]);
  });
  it.each([{ silenceRequested: false }, { sourceType: "upload" as const }, { isExample: true }, { midform: true }, { language: "fr" }])("preserves unrelated admissions: %j", patch => {
    const { rollout, existing } = fixture(); expect(selectSilenceAdmissionTarget({ ...request, ...patch }, existing, rollout)).toEqual({ mode: "existing", target: existing });
  });
  it.each(["off", "missing", "mixed-image", "mixed-font", "duplicate-lane", "qa-queue", "other-queue", "invalid-percentage"])("falls back before admission when candidate is %s", fault => {
    const { rollout, existing } = fixture();
    if (fault === "off") rollout.enabled = false;
    if (fault === "mixed-image") rollout.targets[0].workerImageDigest = `sha256:${"f".repeat(64)}`;
    if (fault === "mixed-font") rollout.targets[0].v4Capability!.fontManifestSha256 = "f".repeat(64);
    if (fault === "duplicate-lane") rollout.targets[1].targetKey = rollout.targets[0].targetKey;
    if (fault === "qa-queue") rollout.targets[0].jobQueueArn = queue.replace("project-fargate-production", "editor-test");
    if (fault === "other-queue") rollout.targets[0].jobQueueArn = queue.replace("project-fargate-production", "other-production");
    if (fault === "invalid-percentage") rollout.percentage = NaN;
    expect(selectSilenceAdmissionTarget(request, existing, fault === "missing" ? null : rollout)).toEqual({ mode: "existing", target: existing });
  });
  it("uses a repeatable user cohort and turns off new routing without changing stored targets", () => {
    const { rollout, existing } = fixture(); const bucket = silenceRolloutBucket(user, release);
    rollout.percentage = bucket; expect(selectSilenceAdmissionTarget(request, existing, rollout).mode).toBe("existing");
    rollout.percentage = bucket + 1; const pinned = selectSilenceAdmissionTarget(request, existing, rollout);
    expect(pinned.mode).toBe("inline"); rollout.enabled = false;
    expect(selectSilenceAdmissionTarget(request, existing, rollout).mode).toBe("existing");
    expect(pinned.target.workerSourceGitSha).toBe("b".repeat(40));
  });
});
