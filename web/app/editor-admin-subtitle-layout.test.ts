import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("admin editor subtitle layout", () => {
  const editorSource = source("./shorts-app.tsx");

  it("shows the tool only for an administrator canary v3 release with subtitles", () => {
    expect(editorSource).toContain(
      'editorRelease.channel === "canary"\n    && editorRelease.documentVersion === 3',
    );
    expect(editorSource).toContain('{ id: "subtitle", label: "자막" }');
    expect(editorSource).toContain(
      'tool.id !== "subtitle"\n              || (\n                adminSubtitleLayoutEnabled\n                && subtitlesEnabled\n                && segments.length > 0',
    );
  });

  it("offers vertical position and size controls with a live preview", () => {
    expect(editorSource).toContain('aria-label="자막 세로 위치"');
    expect(editorSource).toContain('aria-label="자막 크기"');
    expect(editorSource).toContain("bottom: `${renderSubtitleBottom}%`");
    expect(editorSource).toContain("fontSize: `${renderSubtitleFontSize}cqw`");
    expect(editorSource).toContain("가로 중앙에 고정됩니다");
  });

  it("sends a subtitle layout only through the admin v3 snapshot", () => {
    expect(editorSource).toContain(
      "adminSubtitleLayoutEnabled ? subtitleLayout : undefined",
    );
    const routeSource = source("./api/shorts/[shortId]/apply-edit/route.ts");
    expect(routeSource).toContain('release.channel !== "canary"');
    expect(routeSource).toContain("EDITOR_SUBTITLE_LAYOUT_ADMIN_ONLY");
  });
});
