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
    expect(stateSource).toContain("fileUploadAccess.enabled");
  });

  it("selects locally first and sends bytes directly only after canonical project creation", () => {
    expect(source).toContain("inspectUploadVideo(file)");
    expect(source).toContain('requestJson<{');
    expect(source).toContain('>("/api/file-upload/sessions"');
    expect(source).toContain("await uploadFileWhenReceiverReady({");
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

  it("guards the active transfer in a modal and confirms server receipt explicitly", () => {
    expect(source).toContain("const uploadExitGuardActive = uploadPreparationActive || uploadTransferActive");
    expect(source).toContain('window.addEventListener("beforeunload", warnBeforeUnload)');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("업로드 완료");
    expect(source).toContain("이제 창을 닫아도 쇼츠 생성 작업은 계속됩니다.");
    expect(source).toContain("영상 업로드 중");
    expect(source).toContain("업로드가 끝날 때까지 이 탭을 열어두세요.");
    expect(source).toContain("업로드 시작 중");
    expect(source).toContain("업로드 취소");
    expect(source).toContain("setScrollToProjects(true)");
    expect(source).not.toContain("업로드 서버를 준비하고 있어요");
    expect(source).not.toContain("서버 준비 중");
    expect(source).not.toContain("준비 취소");
    expect(source).toContain("setUploadCompletionOpen(true)");
    expect(source).toContain('uploadDragActive ? "is-dragging"');
  });

  it("requires beta acknowledgement before creating an upload session", () => {
    expect(source).toContain("const [uploadBetaNoticeOpen, setUploadBetaNoticeOpen] = useState(false)");
    expect(source).toContain("if (!betaNoticeConfirmed)");
    expect(source).toContain("setUploadBetaNoticeOpen(true)");
    expect(source).toContain("파일 업로드 기능은 현재 베타 서비스예요.");
    expect(source).toContain("업로드가 진행되는 동안 새 창에서 다른 작업을 시작해 보세요.");
    expect(source).toContain("확인하고 업로드");
    expect(source).toContain("void createUploadJob(true)");
    expect(source.indexOf("if (!betaNoticeConfirmed)")).toBeLessThan(
      source.indexOf('>("/api/file-upload/sessions"'),
    );
  });

  it("keeps the preparation progress track visually empty", () => {
    expect(source).toContain('aria-valuetext="업로드 시작 중"');
    expect(source).not.toContain("w-1/3 animate-pulse");
  });

  it("does not invent a visible channel name for local uploads", () => {
    expect(source).toContain('channelName: "",');
    expect(source).not.toContain('channelName: "업로드한 영상"');
  });
});
