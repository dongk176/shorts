import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_FONT_ID,
  editorFontFamily,
  editorFontLabel,
  editorFontOptions,
  editorCaptionCssToAssScaleById,
  editorCaptionCssToAssBaselineOffsetEmById,
  editorFontSha256ById,
  editorTitleBaselineOffsetEmById,
  isStableEditorFontId,
  resolveEditorFontFace,
  resolveEditorFontFaceV4,
  stableEditorFontIds,
  stableEditorFontOptions,
} from "@/lib/editor-fonts";

const editorStyles = readFileSync(
  new URL("../app/editor-v2.css", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const rootLayout = readFileSync(
  new URL("../app/layout.tsx", import.meta.url),
  "utf8",
);
const applyEditRoute = readFileSync(
  new URL("../app/api/shorts/[shortId]/apply-edit/route.ts", import.meta.url),
  "utf8",
);

describe("editor fonts", () => {
  it("exposes the bundled commercially usable Korean font choices", () => {
    expect(editorFontOptions).toHaveLength(20);
    expect(new Set(editorFontOptions.map((font) => font.id)).size).toBe(20);
  });

  it("keeps the promoted exact-face fonts in the stable renderer", () => {
    expect(stableEditorFontOptions.map((font) => font.id))
      .toEqual(stableEditorFontIds);
    expect(stableEditorFontIds).toContain("paperlogy");
    expect(isStableEditorFontId("pretendard")).toBe(true);
    expect(isStableEditorFontId("spoqa-han-sans-neo")).toBe(true);
    expect(isStableEditorFontId("paperlogy")).toBe(true);
    expect(isStableEditorFontId("jua")).toBe(true);
    expect(isStableEditorFontId("ridi-batang")).toBe(true);
    expect(isStableEditorFontId(null)).toBe(false);
    expect(applyEditRoute).not.toContain("EDITOR_FONT_CANARY_ONLY");
    expect(applyEditRoute).not.toContain("관리자 테스트 편집기");
  });

  it("uses Pretendard as the safe default", () => {
    expect(DEFAULT_EDITOR_FONT_ID).toBe("pretendard");
    expect(editorFontFamily(undefined)).toContain("Editor Pretendard");
    expect(editorFontLabel(undefined)).toBe("프리텐다드");
  });

  it("keeps defaults first, then casual display fonts before formal faces", () => {
    expect(editorFontOptions.map((font) => font.id)).toEqual([
      "pretendard",
      "noto-sans-kr",
      "do-hyeon",
      "jua",
      "jalnan-2",
      "cafe24-anemone",
      "cafe24-pro-up",
      "sandbox-aggro",
      "galmuri-9",
      "black-han-sans",
      "godo",
      "paperlogy",
      "gmarket-sans",
      "nanum-square-neo",
      "s-core-dream",
      "suit",
      "spoqa-han-sans-neo",
      "noto-serif-kr",
      "nanum-myeongjo",
      "ridi-batang",
    ]);
  });

  it("resolves a selected font to its bundled editor family", () => {
    expect(editorFontFamily("black-han-sans")).toContain("Editor Black Han Sans");
    expect(editorFontFamily("paperlogy")).toContain("Editor Paperlogy");
    expect(editorFontLabel("spoqa-han-sans-neo")).toBe("스포카 한 산스");
  });

  it("loads every picker preview face through the candidate stylesheet path", () => {
    expect(rootLayout).toContain('import "./editor-v2.css";');
    const loadedFontCss = `${globalStyles}\n${editorStyles}`;
    for (const option of editorFontOptions) {
      const family = option.family.match(/^"([^"]+)"/)?.[1];
      expect(family).toBeTruthy();
      expect(loadedFontCss).toContain(`font-family: "${family}"`);
      expect(loadedFontCss).toContain(`/fonts/editor/${option.fileName}`);
    }
  });

  it("uses only real static weights and separates Noto title/text axes", () => {
    expect(resolveEditorFontFace("pretendard", "text")).toMatchObject({
      requestedWeight: 800,
      resolvedWeight: 700,
      variableWeight: null,
    });
    expect(resolveEditorFontFace("black-han-sans", "title")).toMatchObject({
      requestedWeight: 700,
      resolvedWeight: 400,
      variableWeight: null,
    });
    expect(resolveEditorFontFace("noto-serif-kr", "title")).toMatchObject({
      resolvedWeight: 700,
      variableWeight: 700,
    });
    expect(resolveEditorFontFace("noto-serif-kr", "text")).toMatchObject({
      resolvedWeight: 800,
      variableWeight: 800,
    });
    expect(resolveEditorFontFace("noto-sans-kr", "text")).toMatchObject({
      resolvedWeight: 800,
      variableWeight: 800,
    });
  });

  it("pins every v4 face to an exact file hash and measured CSS-to-ASS scale", () => {
    expect(Object.keys(editorFontSha256ById)).toEqual(
      editorFontOptions.map((font) => font.id),
    );
    expect(Object.keys(editorCaptionCssToAssScaleById)).toEqual(
      editorFontOptions.map((font) => font.id),
    );
    expect(Object.keys(editorCaptionCssToAssBaselineOffsetEmById)).toEqual(
      editorFontOptions.map((font) => font.id),
    );
    expect(Object.keys(editorTitleBaselineOffsetEmById)).toEqual(
      editorFontOptions.map((font) => font.id),
    );
    for (const option of editorFontOptions) {
      expect(editorFontSha256ById[option.id]).toMatch(/^[0-9a-f]{64}$/);
      expect(createHash("sha256").update(readFileSync(
        new URL(`../public/fonts/editor/${option.fileName}`, import.meta.url),
      )).digest("hex")).toBe(editorFontSha256ById[option.id]);
      expect(editorCaptionCssToAssScaleById[option.id]).toBeGreaterThanOrEqual(0.5);
      expect(editorCaptionCssToAssScaleById[option.id]).toBeLessThanOrEqual(1.5);
      expect(
        editorCaptionCssToAssScaleById[option.id] * 1_000_000,
      ).toBe(Math.round(editorCaptionCssToAssScaleById[option.id] * 1_000_000));
      expect(editorTitleBaselineOffsetEmById[option.id]).toBeGreaterThanOrEqual(-0.25);
      expect(editorTitleBaselineOffsetEmById[option.id]).toBeLessThanOrEqual(0.75);
      expect(
        editorTitleBaselineOffsetEmById[option.id] * 1_000_000,
      ).toBe(Math.round(editorTitleBaselineOffsetEmById[option.id] * 1_000_000));
    }
    expect(editorFontSha256ById.paperlogy).toBe(
      "fe71049fe3d3a7dd3f2e0c12efd850acd1293658181af322348edde9b016e6ba",
    );
    expect(editorCaptionCssToAssScaleById.paperlogy).toBe(0.849057);
    expect(editorCaptionCssToAssBaselineOffsetEmById["noto-sans-kr"]).toBe(
      0.021739,
    );
    expect(editorTitleBaselineOffsetEmById["gmarket-sans"]).toBe(0.3);
  });

  it("resolves a v4 face without a fallback family", () => {
    expect(resolveEditorFontFaceV4("paperlogy", "title")).toEqual({
      fontId: "paperlogy",
      fileId: "Paperlogy-7Bold.ttf",
      family: '"Editor V4 Paperlogy"',
      requestedWeight: 700,
      resolvedWeight: 700,
      variableWeight: null,
      sha256: editorFontSha256ById.paperlogy,
      metrics: {
        revision: "editor-font-metrics-v2",
      },
    });
  });
});
