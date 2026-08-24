import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  new URL("./shorts-app.tsx", import.meta.url),
  "utf8",
);
const editorStyles = readFileSync(
  new URL("./editor-v2.css", import.meta.url),
  "utf8",
);

describe("editor v2 resilience", () => {
  it("loads and continuously writes version-scoped browser drafts", () => {
    expect(editorSource).toContain(
      "readEditorDraft(item.id, item.renderVersion)",
    );
    expect(editorSource).toContain(
      "const record = createEditorDraftRecord(editorDocumentSnapshot)",
    );
    expect(editorSource).toContain("writeEditorDraft(record)");
    expect(editorSource).toContain("}, 800)");
    expect(editorSource).toContain('이어서 <span className="text-[#ff715e]">편집</span>할까요?');
    expect(editorSource).toContain("마지막으로 저장했어요.");
    expect(editorSource).not.toContain("편집하던 내용을 이어갈까요?");
    expect(editorSource).toContain("editorDraftSavedAgoLabel(");
    expect(editorSource).toContain(
      "editorDraftDocumentSnapshotSchema.safeParse(",
    );
    expect(editorSource).not.toContain('"임시 저장됨"');
  });

  it("saves the full current draft with Command-S and Control-S", () => {
    expect(editorSource).toContain(
      "const saveEditorDraftNow = useCallback(async () =>",
    );
    expect(editorSource).toContain("(!event.metaKey && !event.ctrlKey)");
    expect(editorSource).toContain('event.key.toLowerCase() !== "s"');
    expect(editorSource).toContain(
      'window.addEventListener("keydown", handleEditorDraftShortcut, true)',
    );
    expect(editorSource).toContain("void saveEditorDraftNow()");
  });

  it("flushes a pending edit when the in-app editor closes", () => {
    const cleanupStart = editorSource.indexOf(
      "if (editorDraftWriteTimerRef.current !== null)",
    );
    const cleanupSource = editorSource.slice(cleanupStart, cleanupStart + 850);
    expect(cleanupStart).toBeGreaterThan(-1);
    expect(cleanupSource).toContain("editorDraftLatestValidRef.current");
    expect(cleanupSource).toContain("editorDraftNeedsWriteRef.current");
    expect(cleanupSource).toContain(
      "writeEditorDraft(createEditorDraftRecord(document))",
    );
  });

  it("restores every render-facing draft domain on re-entry", () => {
    const restoreStart = editorSource.indexOf(
      "const continueEditorDraft = useCallback(() =>",
    );
    const restoreSource = editorSource.slice(restoreStart, restoreStart + 5_000);
    expect(restoreStart).toBeGreaterThan(-1);
    [
      "setTitle(document.title.text)",
      "setTitleTextStyles(",
      "setTitleFontScale(document.title.fontScale)",
      "setChannel(document.channel.displayName)",
      "setEditorChannelThumbnailUrl(channelThumbnailUrl)",
      "setSubtitlesEnabled(document.subtitles.enabled)",
      "setSegments(cloneEditorSubtitleSegments(document.subtitles.segments))",
      "setComments(cloneEditorComments(document.comments))",
      "setTemplateId(document.template.id)",
      "setOverlayLayout(cloneEditorOverlayLayout(document.overlays))",
      "setVideoClips(cloneEditorVideoClips(document.video.clips))",
      "setSelectionStart(document.video.selectionStartSeconds)",
      "setSelectionEnd(document.video.selectionEndSeconds)",
    ].forEach((statement) => expect(restoreSource).toContain(statement));
  });

  it("keeps hook-title sizing only in the left sidebar", () => {
    expect(editorSource).toContain(
      'const scalableBaseOverlaySelection = selectedOverlay === "channel"',
    );
    expect(editorSource).not.toContain(
      'selectedOverlay === "title"\n    || selectedOverlay === "channel"',
    );
    expect(editorSource).not.toContain(
      "const titleScale = renderOverlayLayout.scales.title",
    );
    expect(editorSource).toContain(
      'const scale = layer === "channel" ? channelScale : null;',
    );
  });

  it("resolves a persisted channel image asset back into the v2 preview", () => {
    expect(editorSource).toContain(
      "editorChannelAssetPreviewUrl(item.id, item.renderVersion)",
    );
    expect(editorSource).toContain(
      "const renderChannelThumbnailUrl = editorDocumentSnapshot.channel.thumbnailAssetKey",
    );
    expect(editorSource).not.toContain(
      "const renderChannelThumbnailUrl = editorDocumentSnapshot.channel.thumbnailUrl;",
    );
  });

  it("asks about a saved draft before opening the editor and resumes silently", () => {
    const projectStart = editorSource.indexOf("function ProjectWorkspace(");
    const projectSource = editorSource.slice(projectStart);
    expect(projectStart).toBeGreaterThan(-1);
    expect(projectSource).toContain(
      "readEditorDraft(item.id, item.renderVersion)",
    );
    expect(projectSource).toContain("subscribeEditorDraftChanges");
    expect(projectSource).toContain(
      'window.addEventListener("focus", refreshEditorDrafts)',
    );
    expect(projectSource).toContain(
      'document.addEventListener("visibilitychange", refreshWhenVisible)',
    );
    expect(projectSource).toContain("<EditorDraftEntryDialog");
    expect(projectSource).toContain(
      'target.searchParams.set("draftChoice", choice)',
    );
    expect(editorSource).toContain('entryChoice === "new"');
    expect(editorSource).toContain("continueEditorDraft();");
    const editorContentStart = editorSource.indexOf("const editorContent = (");
    const editorContentSource = editorSource.slice(
      editorContentStart,
      projectStart,
    );
    expect(editorContentSource).not.toContain("<EditorDraftEntryDialog");
  });

  it("uses an icon-free, brand-colored saved draft entry dialog", () => {
    const dialogStart = editorSource.indexOf("function EditorDraftEntryDialog(");
    const dialogEnd = editorSource.indexOf(
      "function EditorDraftDiscardConfirmDialog(",
      dialogStart,
    );
    const dialogSource = editorSource.slice(dialogStart, dialogEnd);
    expect(dialogStart).toBeGreaterThan(-1);
    expect(dialogSource).toContain("#ff715e");
    expect(dialogSource).toContain("이어서 편집");
    expect(dialogSource).toContain("새로 시작");
    expect(dialogSource).not.toContain("→");
    expect(dialogSource).not.toContain("<svg");
  });

  it("requires a second confirmation before deleting a saved draft", () => {
    const projectStart = editorSource.indexOf("function ProjectWorkspace(");
    const projectSource = editorSource.slice(projectStart);
    expect(projectSource).toContain("<EditorDraftDiscardConfirmDialog");
    expect(projectSource).toContain(
      "onStartNew={() => setEditorDraftDiscardConfirmationOpen(true)}",
    );
    expect(projectSource).toContain(
      'onConfirm={() => openEditorFromDraftEntry("new")}',
    );
    expect(editorSource).toContain(
      "새로 시작하면 저장된 편집 내용이 삭제돼요.",
    );
    expect(editorSource).toContain("text-red-300/75");
  });

  it("removes and restores each deleted comment's saved position with undo", () => {
    const deleteStart = editorSource.indexOf(
      "const deleteEditorComment = useCallback((id: string) =>",
    );
    const deleteSource = editorSource.slice(deleteStart, deleteStart + 1_400);
    expect(deleteStart).toBeGreaterThan(-1);
    expect(deleteSource).toContain(
      "overlayLayoutRef.current.commentOffsets[id]",
    );
    expect(deleteSource).toContain("delete nextLayout.commentOffsets[id]");
    expect(editorSource).toContain(
      "nextLayout.commentOffsets[deletedComment.comment.id]",
    );
    expect(editorSource).toContain(
      "delete nextLayout.commentOffsets[deletedComment.comment.id]",
    );
  });

  it("runs pointer and keyboard history controls without losing the action", () => {
    const controlsStart = editorSource.indexOf(
      'className="editor-history-controls"',
    );
    const controlsSource = editorSource.slice(controlsStart, controlsStart + 1_600);
    expect(controlsStart).toBeGreaterThan(-1);
    expect(controlsSource).toContain("onPointerDown={(event) => {");
    expect(controlsSource).toContain("event.preventDefault();");
    expect(controlsSource).toContain("if (event.detail !== 0) return;");
    expect(controlsSource).toContain(
      "finishPendingEditorInteractionsForHistory()",
    );
    expect(controlsSource).toContain("undoEditorEdit();");
    expect(controlsSource).toContain("redoEditorEdit();");
  });

  it("commits a pending caption transaction before global history or save", () => {
    expect(editorSource).toContain(
      "editorCaptionTextDraftChanged(",
    );
    expect(editorSource).toContain("|| hasPendingCaptionTextChange");
    expect(editorSource).toContain("&& !hasPendingCaptionTextChange");
    expect(editorSource).toContain(
      "if (captionTextDraft && textInputTarget) return;",
    );
    expect(editorSource).toContain("const editorDocumentSubtitleLayout");
    expect(editorSource).toContain("editorSubtitleLayoutWithCaptionDraft(");
    expect(editorSource).toContain("hasInvalidCaptionTextDraft");
    expect(editorSource).toContain(
      "finishPendingEditorInteractionsForHistory()",
    );
    expect(editorSource).toContain(
      "자막 문구는 비워둘 수 없습니다.",
    );
    expect(editorSource).toContain(
      "finishPendingEditorInteractionsIncludingCaption();",
    );
    expect(editorSource).toContain("closeEditorAfterSavingCaptionDraft");
    expect(editorSource).toContain("void saveEditorDraftNow().finally(onClose);");
    expect(editorSource).toContain("onClick={openEditorApplyConfirmation}");
  });

  it("finishes caption copy before split, trim and outer range edits", () => {
    for (const marker of [
      "const splitCurrentEditorVideo = useCallback(() =>",
      "const beginEditorVideoClipTrim = useCallback((",
      'const startRangeInteraction = (handle: "start" | "end"',
    ]) {
      const start = editorSource.indexOf(marker);
      expect(start).toBeGreaterThan(-1);
      expect(editorSource.slice(start, start + 650)).toContain(
        "finishPendingEditorInteractionsIncludingCaption();",
      );
    }
  });

  it("records outer range-handle trims as one video history action for the admin candidate", () => {
    const start = editorSource.indexOf("const startRangeInteraction = (");
    const finish = editorSource.indexOf("const finishTimelineScrubbing = (");
    expect(start).toBeGreaterThan(-1);
    expect(finish).toBeGreaterThan(start);
    expect(editorSource.slice(start, start + 900)).toContain(
      "adminSubtitleLayoutEnabled && videoCuttingEnabled",
    );
    expect(editorSource.slice(finish, finish + 800)).toContain(
      "recordEditorVideoStep(",
    );
  });

  it("undoes the visibility change made while adding the first comment", () => {
    const addStart = editorSource.indexOf("const addComment = () =>");
    const addSource = editorSource.slice(addStart, addStart + 2_000);
    expect(addStart).toBeGreaterThan(-1);
    expect(addSource).toContain("visibleCommentBefore");
    expect(addSource).toContain("{ before: visibleCommentBefore, after: true }");
    expect(editorSource).toContain(
      'typeof replacement.visibleCommentBefore === "boolean"',
    );
    expect(editorSource).toContain(
      'typeof replacement.visibleCommentAfter === "boolean"',
    );
  });

  it("removes text overlays outside a shortened output before applying", () => {
    const saveStart = editorSource.indexOf("const save = async () =>");
    const saveSource = editorSource.slice(saveStart, saveStart + 3_000);
    expect(saveStart).toBeGreaterThan(-1);
    expect(saveSource).toContain("fitTimedRangesToDurationFrames(");
    expect(saveSource).toContain("retainedTextOverlayIds");
    expect(saveSource).toContain('layer.startsWith("text:")');
  });

  it("only deletes a draft when the user chooses to start over", () => {
    const entryChoiceStart = editorSource.indexOf(
      'if (entryChoice === "new")',
    );
    expect(entryChoiceStart).toBeGreaterThan(-1);
    expect(editorSource.slice(entryChoiceStart, entryChoiceStart + 700))
      .toContain("deleteEditorDraft(item.id, item.renderVersion)");
    expect(editorSource).not.toContain("7 * 24 * 60");
  });

  it("refreshes signed video URLs before expiry and retries one media error", () => {
    expect(editorSource).toContain(
      'refreshEditorVideoSource("scheduled")',
    );
    expect(editorSource).toContain("editorVideoUrlRefreshDelay(");
    expect(editorSource).toContain("editorVideoRetryCountRef.current >= 1");
    expect(editorSource).toContain("편집용 영상을 다시 연결하고 있어요");
    expect(editorSource).toContain("편집용 영상 연결이 끊어졌어요.");
  });

  it("checks admin candidate cut boundaries every frame while preserving stable playback", () => {
    expect(editorSource).toContain(
      "const advanceEditorVideoPlaybackBoundary = useCallback(",
    );
    expect(editorSource).toContain(
      "window.requestAnimationFrame(checkPlaybackBoundary)",
    );
    expect(editorSource).toContain(
      "editorVideoPlaybackBoundaryTransition(",
    );
    expect(editorSource).toContain(
      "!adminSubtitleLayoutEnabled",
    );
    expect(editorSource).toContain(
      "current >= clip.sourceEndSeconds - 0.03",
    );
  });

  it("keeps draft status styling inside the v2 root", () => {
    expect(editorStyles).toContain(
      ".editor-v2-root .editor-draft-status {",
    );
    expect(editorStyles).not.toMatch(/^\.editor-draft-status/m);
  });

  it("does not cover a selected canvas background with the comment template surface", () => {
    const surfaceStart = editorSource.indexOf(
      'data-editor-comment-capture-surface=""',
    );
    const surfaceSource = editorSource.slice(surfaceStart, surfaceStart + 650);
    expect(surfaceStart).toBeGreaterThan(-1);
    expect(surfaceSource).toContain(
      'overlayPreviewEnabled\n                            && editorCanvasBackground\n                            ? "transparent"',
    );
    expect(surfaceSource).toContain('editorCommentTheme === "dark"');
  });

  it("shows selected video clips with a simple solid outline", () => {
    const selector = ".editor-v2-root .editor-video-clip-strip > button[data-editor-video-clip-id].is-selected {";
    const start = editorStyles.indexOf(selector);
    const block = editorStyles.slice(start, editorStyles.indexOf("}", start));
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain("filter: none;");
    expect(block).toContain("box-shadow: none;");
    expect(block).not.toContain("gradient");
    expect(editorStyles).toContain(
      ".editor-v2-root .editor-video-clip-strip > button[data-editor-video-clip-id].is-selected::after {",
    );
    expect(editorStyles).toContain("border: 4px solid #fff;");
  });

  it("uses an opaque white selection frame for the preview video", () => {
    const frameStart = editorSource.indexOf("data-editor-video-resize-frame");
    const frameSource = editorSource.slice(frameStart, frameStart + 1_400);
    expect(frameStart).toBeGreaterThan(-1);
    expect(frameSource).toContain('border-2 border-white');
    expect(frameSource).toContain('bg-white');
    expect(frameSource).not.toContain('border-[#ff715e]');
    expect(editorSource).toContain(
      'selectedOverlay === "video" ? " outline outline-2 outline-white',
    );
  });
});
