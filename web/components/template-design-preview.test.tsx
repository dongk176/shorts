import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomTemplateCanvasPreview } from "@/components/custom-template-canvas-preview";
import { EditorTextOverlayPaint } from "@/components/editor-text-overlay-paint";
import { EditorTextOverlayControls } from "@/components/editor-text-overlay-controls";
import { TemplateEditor } from "@/app/templates/template-editor";
import { addTemplateTextOverlay, templateTextRenderSpec } from "@/lib/template-design-preview";
import { createDefaultTemplateConfig, type CustomTemplate } from "@/lib/template-config";

const id = "9bfcc905-bbbf-46b5-812b-7fb1c5c0bde4";
const config = addTemplateTextOverlay(createDefaultTemplateConfig(), id);
config.background = { kind: "uploaded_image", assetId: id };
config.textOverlays![0].text = "첫 줄\n\n다음 줄";
const template: CustomTemplate = {
  id, name: "내 템플릿", baseTemplateId: "dark-minimal", config,
  version: 1, createdAt: "2026-08-31T00:00:00Z", updatedAt: "2026-08-31T00:00:00Z",
};

describe("template design presentation", () => {
  it("renders uploaded backgrounds and fixed text in a card without nested controls", () => {
    const html = renderToStaticMarkup(createElement(CustomTemplateCanvasPreview, {
      template, firstLine: "제목", secondLine: "두 번째 줄", channelLabel: "채널",
    }));
    expect(html).toContain(`/api/background-assets/${id}`);
    expect(html).toContain('data-editor-text-overlay-id=');
    expect(html).toContain("첫 줄");
    expect(html).toContain("다음 줄");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<textarea");
  });

  it("paints each canonical line, including blank lines, without CSS re-wrapping", () => {
    const overlay = config.textOverlays![0];
    const html = renderToStaticMarkup(createElement(EditorTextOverlayPaint, {
      textOverlay: overlay, renderSpec: templateTextRenderSpec(overlay),
    }));
    expect(html.match(/class="block whitespace-pre"/g)).toHaveLength(3);
    expect(html).toContain('min-height:1.2em"> </span>');
    expect(html).not.toContain("<button");
  });

  it("exposes the same text styling with width, size, layer order but no timing controls", () => {
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(EditorTextOverlayControls, {
      textOverlay: config.textOverlays![0], onChange: noop, onFontChange: noop,
      onInteractionStart: noop, onInteractionEnd: noop, onDelete: noop,
      geometryControls: { onScaleChange: noop, onWidthChange: noop, onMoveLayer: noop, canMoveForward: false, canMoveBackward: true },
    }));
    for (const label of ["폰트", "색상", "테두리", "그림자", "텍스트 폭", "글자 크기", "앞으로", "뒤로", "선택한 텍스트 삭제"]) expect(html).toContain(label);
    expect(html).toContain('maxLength="120"');
    expect(html).toContain('min="0.5" max="2"');
    expect(html).toContain('min="1" max="1000"');
    expect(html).not.toContain("노출 구간");
    expect(html).not.toContain("startSeconds");
  });

  it("keeps stored design readable while the new controls are disabled", () => {
    const html = renderToStaticMarkup(createElement(TemplateEditor, {
      initialTemplate: template, baseTemplateId: "dark-minimal", initialConfig: config,
    }));
    expect(html).toContain("첫 줄");
    expect(html).not.toContain("배경 이미지 업로드");
    expect(html).not.toContain("템플릿 추가 텍스트 목록");
  });

  it("provides the shared library and extra text when administrator access is enabled", () => {
    const html = renderToStaticMarkup(createElement(TemplateEditor, {
      initialTemplate: template, baseTemplateId: "dark-minimal", initialConfig: config,
      customTemplateDesignEnabled: true,
    }));
    expect(html).toContain("배경 이미지 업로드");
    expect(html).toContain("템플릿 추가 텍스트 목록");
    expect(html).toContain("1/20");
  });

  it("matches the editor two-stage sidebar and keeps background as its own tool", () => {
    const html = renderToStaticMarkup(createElement(TemplateEditor, {
      initialTemplate: template, baseTemplateId: "dark-minimal", initialConfig: config,
      customTemplateDesignEnabled: true,
    }));
    expect(html).toContain('aria-label="템플릿 편집 도구"');
    expect(html).toContain('id="template-tool-detail"');
    const labels = ["후킹 제목", "텍스트", "자막", "댓글", "채널명", "배경", "템플릿"];
    labels.reduce((lastIndex, label) => {
      const index = html.indexOf(label, lastIndex + 1);
      expect(index).toBeGreaterThan(lastIndex);
      return index;
    }, -1);
    expect(html).toContain("fixed bottom-0 left-0 top-16");
    expect(html).toContain("pl-[504px]");
    expect(html).toContain("배경 이미지 업로드");
  });
});
