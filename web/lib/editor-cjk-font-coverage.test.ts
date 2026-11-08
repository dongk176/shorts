import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import coverage from "./editor-cjk-font-coverage.json";
import { contentTextFont, hasUnsupportedCjkFont, supportsCjkText } from "./content-language";

describe("exact bundled CJK glyph coverage", () => {
  it.each(Object.entries(coverage))("pins %s coverage to the identical web and worker font bytes", (_id, font) => {
    for (const directory of ["../public/fonts/editor", "../../worker/shorts_worker/assets/editor_fonts"]) {
      const bytes = readFileSync(new URL(`${directory}/${font.file}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(font.sha256);
    }
  });
  it.each(["noto-sans-kr", "noto-serif-kr"])("avoids browser fallback glyphs missing from %s in Japanese titles, captions and overlays", (font) => {
    expect(supportsCjkText("教科書版の人狼ゲーム？", font, true)).toBe(true);
    expect(supportsCjkText("数学の単元を当てろ！", font, true)).toBe(false);
    expect(contentTextFont("数学の単元を当てろ！", font, true)).toBe("noto-sans-jp");
    const doc = {title:{text:"数学"},channel:{displayName:"English"},overlays:{fonts:{title:font,channel:font},visible:{title:true,channel:true},textOverlays:[] as Array<{text:string;fontId:string}>}};
    expect(hasUnsupportedCjkFont(doc)).toBe(true);
    doc.overlays.visible.title = false; doc.channel.displayName = "単元";
    expect(hasUnsupportedCjkFont(doc)).toBe(true);
    doc.overlays.visible.channel = false; doc.overlays.textOverlays = [{text:"数学",fontId:font}];
    expect(hasUnsupportedCjkFont(doc)).toBe(true);
  });
  it("uses the Japanese face only on a compatible worker and rejects glyphs absent even there", () => {
    expect(supportsCjkText("数学の単元を当てろ！", "noto-sans-jp", true)).toBe(true);
    expect(supportsCjkText("数学", "noto-sans-jp", false)).toBe(false);
    expect(supportsCjkText("\u{31350}", "noto-sans-jp", true)).toBe(false);
    expect(supportsCjkText("한글 English", "pretendard", false)).toBe(true);
  });
});
