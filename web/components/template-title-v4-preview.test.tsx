import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
  new URL("./template-title-v4-preview.tsx", import.meta.url),
  "utf8",
);
const customCanvasSource = readFileSync(
  new URL("./custom-template-canvas-preview.tsx", import.meta.url),
  "utf8",
);
const templateEditorSource = readFileSync(
  new URL("../app/templates/template-editor.tsx", import.meta.url),
  "utf8",
);
const templateLibrarySource = readFileSync(
  new URL("../app/templates/template-library.tsx", import.meta.url),
  "utf8",
);
const shortsAppSource = readFileSync(
  new URL("../app/shorts-app.tsx", import.meta.url),
  "utf8",
);

describe("TemplateTitleV4Preview consumers", () => {
  it("compiles the authoritative spec and fails closed without a legacy fallback", () => {
    expect(componentSource).toContain(
      "createEditorRenderTitleSpecV4(editorDocument)",
    );
    expect(componentSource).toContain(
      "if (!enabled || !spec) return null;",
    );
    expect(componentSource).toContain("setResult({ key: requestKey, spec: null })");
    expect(componentSource).toContain("<EditorTitleV4Preview");
    expect(componentSource).not.toContain("CustomTemplateTitlePreview");
  });

  it("routes custom canvases and the template editor through v4 only when enabled", () => {
    expect(customCanvasSource).toContain(
      "titleV4Enabled = positionedWordsV4Enabled",
    );
    expect(customCanvasSource).toContain(
      "titleV4Enabled\n        ? <TemplateTitleV4Preview",
    );
    expect(customCanvasSource).toContain(
      ": <CustomTemplateTitlePreview",
    );
    expect(templateEditorSource).toContain(
      "positionedWordsV4Enabled\n                    ? <TemplateTitleV4Preview",
    );
    expect(templateEditorSource).toContain(
      "templateConfig={config}",
    );
  });

  it("routes both public and in-app preset cards through the same v4 compiler", () => {
    expect(templateLibrarySource).toContain(
      "titleV4Enabled={positionedWordsV4Enabled}",
    );
    expect(templateLibrarySource).toContain(
      "? <TemplateTitleV4Preview",
    );
    expect(shortsAppSource).toContain(
      "? <TemplateTitleV4Preview",
    );
    expect(shortsAppSource.match(
      /titleV4Enabled=\{positionedWordsV4Enabled\}/g,
    )).toHaveLength(2);
  });
});
