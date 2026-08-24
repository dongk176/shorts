import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_FONT_ID,
  editorFontFamily,
  editorFontLabel,
  editorFontOptions,
  isStableEditorFontId,
  resolveEditorFontFace,
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

  it("keeps candidate-only fonts out of the promoted stable renderer", () => {
    expect(stableEditorFontOptions.map((font) => font.id))
      .toEqual(stableEditorFontIds);
    expect(stableEditorFontIds).not.toContain("paperlogy");
    expect(isStableEditorFontId("pretendard")).toBe(true);
    expect(isStableEditorFontId("spoqa-han-sans-neo")).toBe(true);
    expect(isStableEditorFontId("jua")).toBe(true);
    expect(isStableEditorFontId("ridi-batang")).toBe(true);
    expect(isStableEditorFontId("paperlogy")).toBe(false);
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
});
