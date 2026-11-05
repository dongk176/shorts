import type { GeneratedShort } from "./contracts";
import type { EditorDocumentJsonObject } from "./editor-document-snapshot";
import { createInitialEditorOverlayLayout, type EditorOverlayLayoutSnapshot, type EditorTextOverlay } from "./editor-overlay-preview";
import { createDefaultTemplateConfig, upgradeTemplateConfigToV5, type TemplatePresetColor, type CustomTemplate } from "./template-config";
import { communityHeadingColor, communityLegacyHeading, communityVideoFrames } from "./community-template-contract";
import type { SnsLanguage } from "./sns-editor-contract";
import { wrapEditorRenderText } from "./editor-render-spec";

// Separate immutable releases. Existing fixed-layout workers must never receive
// documents containing the shared editor's additional layers.
export const UNIFIED_SNS_EDITOR_RELEASE_ID = "66f640ba-d156-4c90-9c4f-f79038bf9d14";
export const UNIFIED_COMMUNITY_EDITOR_RELEASE_ID = "a576138e-1ddf-4469-8494-252058595705";
export { communityHeadingColor };

export const isUnifiedSnsSnapshot = (snapshot: Record<string, unknown> | null | undefined) =>
  snapshot?.snsTemplateVersion === 1 && snapshot.unifiedEditorVersion === 1;

export function snsEditorLayout(snapshot: Record<string, unknown>, ratio: GeneratedShort["videoAspectRatio"]) {
  const community = snapshot.communityTemplateVersion === 1;
  const tall = ratio === "9:16";
  const offset = ["16:9", "5:4", "1:1"].includes(ratio) ? 150 : 0;
  const lines = ratio === "4:5" || tall ? 1 : 2;
  const tags = ratio === "16:9" || ratio === "5:4";
  const sizes = { "16:9": [960, 540], "5:4": [960, 768], "1:1": [960, 960], "4:5": [960, 1200], "9:16": [720, 1280] };
  const [width, height] = sizes[ratio];
  const video = community ? communityVideoFrames[ratio] : [(1080 - width) / 2, (lines === 1 ? 582 : tags ? 774 : 690) + offset, width, height];
  return {
    community, offset, video, textX: tall ? 180 : 60, bodyWidth: tall ? 810 : 960,
    card: [tall ? 60 : 30, 342 + offset, tall ? 960 : 1020, video[1] + video[3] + 30 - 342 - offset]
  };
}

/** A built-in layout, not a user-owned custom template. Never serialize its
 * local display id as customTemplateId. Positions use the existing SNS canvas. */
type SocialTemplate = CustomTemplate & { socialBrandColor: string };
export function socialTemplateBrandColor(template: CustomTemplate | null, fallback: unknown): string {
  return (template as SocialTemplate | null)?.socialBrandColor || String(fallback || "#000000");
}

export function unifiedSnsTemplate(item: Pick<GeneratedShort, "templateSnapshot" | "videoAspectRatio">): SocialTemplate | null {
  const snapshot = item.templateSnapshot;
  if (snapshot?.snsTemplateVersion !== 1) return null;
  const l = snsEditorLayout(snapshot, item.videoAspectRatio);
  const config = upgradeTemplateConfigToV5(createDefaultTemplateConfig("white-yellow"));
  const language = (snapshot.snsLanguage || "ko") as SnsLanguage;
  const brand = String(snapshot.brandColor || "#000000");
  const rgb = parseInt(brand.slice(1), 16);
  const light = 299 * (rgb >> 16) + 587 * ((rgb >> 8) & 255) + 114 * (rgb & 255) >= 160000;
  config.background = { kind: "color", color: "#FFFFFF" };
  config.video = { aspectRatio: item.videoAspectRatio, x: l.video[0], y: l.video[1], width: l.video[2], height: l.video[3], fit: "cover" };
  config.title = {
    ...config.title, x: 540, y: l.community ? 450 : 216 + l.offset, maxWidth: 960, fontSize: l.community ? 58 : 80,
    fontId: language === "ja" ? "noto-sans-jp" : "pretendard", primaryColor: l.community ? "#111111" : light ? "#111111" : "#FFFFFF",
    accentColor: l.community ? "#111111" : light ? "#111111" : "#FFFFFF", primaryBackgroundColor: null, accentBackgroundColor: null,
  };
  config.channel = { ...config.channel, x: 540, y: l.community ? 534 : 416 + l.offset, maxWidth: 960, fontSize: l.community ? 36 : 52, color: "#111111", backgroundColor: null };
  config.comment.visible = true;
  return { id: "builtin-social", socialBrandColor: brand, name: l.community ? "커뮤니티" : "SNS", baseTemplateId: "white-yellow", config, version: 1, createdAt: "", updatedAt: "" };
}

export function seedSnsEditorLayers(item: Pick<GeneratedShort, "templateSnapshot" | "videoAspectRatio" | "startSeconds" | "endSeconds">): EditorOverlayLayoutSnapshot {
  const snapshot = item.templateSnapshot!;
  const l = snsEditorLayout(snapshot, item.videoAspectRatio);
  const content = snapshot.snsContent as { boardName?: string; body: string[]; hashtags: string[] };
  const language = (snapshot.snsLanguage || "ko") as SnsLanguage;
  const result = createInitialEditorOverlayLayout();
  result.fonts = { title: language === "ja" ? "noto-sans-jp" : "pretendard", channel: language === "ja" ? "noto-sans-jp" : "pretendard" };
  const layer = (id: string, text: string, y: number, size: number, color: TemplatePresetColor = "#111111"): EditorTextOverlay => ({
    id, text, fontId: result.fonts.title, color, effect: "none", offset: { x: 0, y: y - 960 }, width: 960, scale: size / 72, startSeconds: 0, endSeconds: item.endSeconds - item.startSeconds,
  });
  result.textOverlays = content.body.map((text, i) => layer(`sns-body-${i}`, text, l.community ? 636 : 524 + l.offset + 90 * i, l.community ? 46 : 72));
  // Keep all copy editable while fitting wrapped text inside its original row.
  // Use the renderer's wrapping so the preview and output have the same bounds.
  result.textOverlays = result.textOverlays.map(overlay => {
    const lines = wrapEditorRenderText(overlay.text, overlay.width).length;
    return lines > 1 ? { ...overlay, scale: Math.min(overlay.scale, 82 / (86 * lines)) } : overlay;
  });
  if (content.hashtags.length) result.textOverlays.push(layer("sns-tags", content.hashtags.join("  "), 718 + l.offset, 47, "#111111"));
  if (l.community) {
    result.textOverlays.unshift(layer("sns-board", content.boardName || communityLegacyHeading[language], 210, 96, communityHeadingColor(String(snapshot.brandColor))));
    result.textOverlays.push(layer("sns-heading", { ko: "실시간 베스트", en: "Trending now", ja: "話題の投稿" }[language], 332, 42));
  }
  result.layerOrder = ["video", "title", "comment", ...result.textOverlays.map(t => `text:${t.id}` as const), "channel"];
  return result;
}

export function unifiedSnsSnapshot(original: Record<string, unknown>, config: CustomTemplate["config"], title: string, overlays: EditorTextOverlay[], brandColor = String(original.brandColor)): EditorDocumentJsonObject {
  const content = original.snsContent as EditorDocumentJsonObject;
  const byId = new Map(overlays.map(o => [o.id, o.text]));
  return {
    ...original as EditorDocumentJsonObject, brandColor, unifiedEditorVersion: 1, config: structuredClone(config) as unknown as EditorDocumentJsonObject,
    snsContent: {
      ...content, title, source: "edited", body: overlays.filter(o => o.id.startsWith("sns-body-")).map(o => o.text),
      hashtags: (byId.get("sns-tags") || "").split(/\s+/).filter(Boolean),
      ...(original.communityTemplateVersion === 1 ? { boardName: byId.get("sns-board") || "" } : {}),
    },
  };
}
