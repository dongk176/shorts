import { describe, expect, it, vi } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import fixture from "../../test-fixtures/unified-social-editor-v4.json";
import { videoAspectRatios } from "./contracts";
import { editorDocumentSnapshotSchema } from "./editor-document-contract";
import { templateConfigSchema } from "./template-config";
import { snsCopyLimits, SNS_GENERATION_RELEASE_IDS, SNS_EDITOR_RELEASE_ID } from "./sns-editor-contract";
import { snsEditorRelease } from "./sns-editor-release";
import { seedSnsEditorLayers, unifiedSnsTemplate, UNIFIED_SNS_EDITOR_RELEASE_ID } from "./unified-sns-editor";
import { assertUnifiedSnsDesignRelease, validateUnifiedSnsEdit } from "./unified-sns-editor-validation";

describe("shared SNS/community editor", () => {
  it.each(videoAspectRatios)("seeds valid movable layers for %s in every language", videoAspectRatio => {
    for (const snsLanguage of ["ko", "en", "ja"] as const) for (const community of [false, true]) {
      const limits = snsCopyLimits(community ? "4:5" : videoAspectRatio, snsLanguage);
      const item = { videoAspectRatio, startSeconds: 10, endSeconds: 14,
        templateSnapshot: { presetVersion: 4, snsTemplateVersion: 1, snsLanguage,
          ...(community ? { communityTemplateVersion: 1 } : {}), brandColor: "#35E6E3",
          snsContent: { title: "Title", boardName: "Board", body: Array(limits.lines).fill("Body"),
            hashtags: ["#a", "#b", "#c"].slice(0, limits.tags), source: "generated" } } };
      const template = unifiedSnsTemplate(item)!;
      expect(templateConfigSchema.safeParse(template.config).success).toBe(true);
      const layers = seedSnsEditorLayers(item);
      expect(layers.textOverlays.filter(t => t.id.startsWith("sns-body-"))).toHaveLength(limits.lines);
      expect(layers.textOverlays.every(t => t.startSeconds === 0 && t.endSeconds === 4)).toBe(true);
      expect(layers.textOverlays.every(t => t.fontId === (snsLanguage === "ja" ? "noto-sans-jp" : "pretendard"))).toBe(true);
      if (community) expect(layers.textOverlays.find(t => t.id === "sns-board")?.color).toBe("#000000");
      const video = template.config.video;
      expect(video.y + video.height).toBeLessThanOrEqual(1920);
    }
  });

  const release = { channel: "canary" as const, releaseId: UNIFIED_SNS_EDITOR_RELEASE_ID,
    uiVersion: 3, documentVersion: 3, subtitleEditingCapable: true,
    subtitleEditingPublicEnabled: false, unifiedTemplateEditingCapable: true };
  it("accepts a browser-authored save and derives copy from editable layers", () => {
    const document = editorDocumentSnapshotSchema.parse(fixture);
    document.overlays.textOverlays = document.overlays.textOverlays.filter(t => t.id !== "sns-body-1");
    document.overlays.textOverlays[0].text = "Edited body";
    document.template.snapshot!.config = { untrusted: true };
    const snapshot = validateUnifiedSnsEdit(document, fixture.template.snapshot, "16:9", release);
    expect(snapshot.snsContent).toMatchObject({ body: ["Edited body"], title: document.title.text });
    expect(templateConfigSchema.safeParse(snapshot.config).success).toBe(true);
  });
  it.each(["legacy-worker", "missing-capability", "language", "template", "ratio", "community"])("rejects incompatible %s", kind => {
    const document = editorDocumentSnapshotSchema.parse(fixture);
    const target = { ...release };
    if (kind === "legacy-worker") target.releaseId = SNS_EDITOR_RELEASE_ID;
    if (kind === "missing-capability") target.unifiedTemplateEditingCapable = false;
    if (kind === "language") document.template.snapshot!.snsLanguage = "ja";
    if (kind === "template") document.template.id = "paper";
    if (kind === "ratio") document.video.aspectRatio = "9:16";
    if (kind === "community") document.template.snapshot!.communityTemplateVersion = 1;
    expect(() => validateUnifiedSnsEdit(document, fixture.template.snapshot, "16:9", target)).toThrow();
  });
  it("activates only a new release with explicit shared-editor proof", async () => {
    const row = { id: UNIFIED_SNS_EDITOR_RELEASE_ID, fontManifestSha256: "a".repeat(64),
      templateSnapshot: { unifiedEditorVersion: 1 }, languageTestReleaseId: SNS_GENERATION_RELEASE_IDS[0],
      details: { generationReleaseIds: SNS_GENERATION_RELEASE_IDS, unifiedTemplateEditorVersion: 1 } };
    const db = vi.fn(async () => [row]) as unknown as Sql;
    expect(await snsEditorRelease(db, "owner", "short")).toMatchObject({ unifiedTemplateEditingCapable: true, subtitleEditingCapable: true });
    row.details.unifiedTemplateEditorVersion = 0;
    await expect(snsEditorRelease(db, "owner", "short")).rejects.toMatchObject({ code: "SNS_EDITOR_UNAVAILABLE" });
  });
});


describe("dedicated social design attestation", () => {
  const sha = "a".repeat(40), digest = "sha256:" + "b".repeat(64), font = "c".repeat(64);
  const proof = () => ({ unifiedTemplateEditorVersion: 1, sourceGitSha: sha, imageDigest: digest,
    fontManifestSha256: font, browserVerification: { desktop: true, mobile: true, sourceGitSha: sha },
    unifiedSocialProbe: { version: 1, runtimeIdentityVerified: true, batchStatus: "SUCCEEDED",
      sourceGitSha: sha, imageDigest: digest, fontManifestSha256: font,
      manifestSha256: "d".repeat(64), manifestS3VersionId: "version", artifactUri: "s3://bucket/outputs/unified-social-verification/manifest.json",
      cases: [{kind:"sns"},{kind:"community",subtitles:true}], customTemplateDesign: {
        version: 1, passed: true, wrapRevision: "editor-text-v1", sourceGitSha: sha,
        workerImageDigest: digest, fontManifestSha256: font, renderSpecVersion: 4, captionRenderSpecVersion: 4,
        verification: {caseCount:3,textOverlayCount:20,deletedTextPreserved:true,maximumFrameMeanError:0.2,
          fontIds:Array.from({length:20},(_,i)=>String(i))}
      }
    }
  });
  const db = (details: unknown, id = UNIFIED_SNS_EDITOR_RELEASE_ID) => vi.fn().mockResolvedValue([{
    id,gitSha:sha,workerImageDigest:digest,fontManifestSha256:font,detailsJson:JSON.stringify(details)
  }]) as unknown as TransactionSql;
  it("requires exact worker, cloud render and browser evidence", async () => {
    await expect(assertUnifiedSnsDesignRelease(db(proof()), UNIFIED_SNS_EDITOR_RELEASE_ID)).resolves.toBeUndefined();
    await expect(assertUnifiedSnsDesignRelease(db(proof(), SNS_EDITOR_RELEASE_ID), SNS_EDITOR_RELEASE_ID)).rejects.toMatchObject({status:503});
    for (const kind of ["digest","browser","runtime","version","design","fonts","deletion"]) {
      const p=proof();
      if(kind==="digest")p.unifiedSocialProbe.imageDigest="wrong";
      if(kind==="browser")p.browserVerification.mobile=false;
      if(kind==="runtime")p.unifiedSocialProbe.runtimeIdentityVerified=false;
      if(kind==="version")p.unifiedSocialProbe.manifestS3VersionId="";
      if(kind==="design")p.unifiedSocialProbe.customTemplateDesign.passed=false;
      if(kind==="fonts")p.unifiedSocialProbe.customTemplateDesign.verification.fontIds=[];
      if(kind==="deletion")p.unifiedSocialProbe.customTemplateDesign.verification.deletedTextPreserved=false;
      await expect(assertUnifiedSnsDesignRelease(db(p),UNIFIED_SNS_EDITOR_RELEASE_ID)).rejects.toMatchObject({status:503});
    }
  });
});
