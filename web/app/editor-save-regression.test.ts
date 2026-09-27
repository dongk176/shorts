import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { deleteEditorVideoClip, editorVideoDuration } from "@/lib/editor-video-cuts";
import { editorDocumentSnapshotSchema } from "@/lib/editor-document-contract";

const source = readFileSync(new URL("./shorts-app.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("shorts-app.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function deletionCallback() {
  let callback = "";
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "deleteSelectedEditorVideoClip"
      && node.initializer && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0].getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!callback) throw new Error("Editor delete callback missing");
  return ts.transpileModule(`callback = ${callback}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

describe("editor deletion through the actual UI callback and save contract", () => {
  it.each(["a", "b", "c"])("keeps deleting clip %s saveable on a nonzero source timeline", (selected) => {
    const document = JSON.parse(readFileSync(new URL("../../test-fixtures/editor-document-v2.json", import.meta.url), "utf8"));
    document.video = { aspectRatio: "1:1", timelineStartSeconds: 100, timelineEndSeconds: 130,
      selectionStartSeconds: 100, selectionEndSeconds: 130,
      clips: [ { id: "a", sourceStartSeconds: 0, sourceEndSeconds: 10 },
        { id: "b", sourceStartSeconds: 10, sourceEndSeconds: 20 },
        { id: "c", sourceStartSeconds: 20, sourceEndSeconds: 30 } ] };
    document.comments = [];
    document.subtitles = { enabled: false, segments: [] };
    document.overlays.textOverlays = [];
    document.overlays.layerOrder = ["video", "title", "comment", "channel"];
    document.overlays.commentOffsets = {};
    expect(editorDocumentSnapshotSchema.safeParse(document).success).toBe(true);
    const context = {
      callback: () => {}, overlayPreviewEnabled: true, selectedVideoClipId: selected,
      editTimeline: { timelineStartSeconds: 100 },
      finishPendingEditorInteractionsIncludingCaption: () => {},
      cloneEditorVideoClips: structuredClone, videoClipsRef: { current: structuredClone(document.video.clips) },
      deleteEditorVideoClip, RANGE_EDIT_MIN_SECONDS: 1, videoRef: { current: { pause: () => {} } },
      recordEditorVideoStep: () => {},
      setVideoClips: (clips: typeof document.video.clips) => { document.video.clips = clips; },
      setSelectionStart: (value: number) => { document.video.selectionStartSeconds = value; },
      setSelectionEnd: (value: number) => { document.video.selectionEndSeconds = value; },
      setSelectedVideoClipId: () => {}, setVideoRippleRevision: () => {},
      editorVideoDuration, seekEditorVideoSequence: () => {},
    };
    vm.createContext(context);
    vm.runInContext(deletionCallback(), context);
    context.callback();
    expect(document.video.clips).toHaveLength(2);
    expect(document.video.selectionStartSeconds).toBe(selected === "a" ? 110 : 100);
    expect(document.video.selectionEndSeconds).toBe(selected === "c" ? 120 : 130);
    expect(editorVideoDuration(document.video.clips)).toBe(20);
    expect(editorDocumentSnapshotSchema.safeParse(document).success).toBe(true);
  });
});
