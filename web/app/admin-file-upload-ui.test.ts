import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./shorts-app.tsx", import.meta.url), "utf8");
const stateSource = readFileSync(new URL("../lib/mvp-state.ts", import.meta.url), "utf8");

describe("administrator file upload UI isolation", () => {
  it("defaults to the unchanged link mode and renders upload controls only through server capability", () => {
    expect(source).toContain('useState<"youtube" | "upload">("youtube")');
    expect(source).toContain("const uploadModeEnabled = state?.capabilities.fileUpload === true");
    expect(source).toContain("{uploadModeEnabled ? (");
    expect(stateSource).toContain("fileUpload: false,");
    expect(stateSource).toContain("unifiedTemplateSubtitles: false,");
    expect(stateSource).toContain("fileUploadAccess.adminEnabled");
  });

  it("selects locally first and sends bytes directly only after canonical project creation", () => {
    expect(source).toContain("inspectUploadVideo(file)");
    expect(source).toContain('requestJson<{');
    expect(source).toContain('>("/api/file-upload/sessions"');
    expect(source).toContain("await uploadFileDirectly({");
    expect(source).toContain("uploadUrl: value.uploadUrl");
    expect(source).not.toContain("업로드하고 계속");
  });

  it("shares the link settings and creates a canonical pending project", () => {
    expect(source).toContain("<SourceRangeSelector");
    expect(source).toContain("<TemplatePicker");
    expect(source).toContain('status: "uploading"');
    expect(source).toContain("recentJobsWithPendingProject");
    expect(source).toContain("/api/file-upload/sessions/${encodeURIComponent(uploadSessionId)}");
  });

  it("keeps the idempotency key when a committed response may have been lost", () => {
    expect(source).toContain("const requestId = uploadRequestId.current");
    expect(source).toContain("const definitiveControlFailure = cause instanceof HttpRequestError");
    expect(source).toContain("|| definitiveControlFailure");
    expect(source).toContain("|| definitiveReceiverFailure");
    expect(source).toContain("|| explicitlyAborted");
    expect(source).not.toContain(
      "} catch (cause) {\n      if (uploadSessionId) {",
    );
  });
});
