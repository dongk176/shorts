import { describe, expect, it } from "vitest";
import {
  applyEditorFontToSelectableText,
  clampCanvasDelta,
  clampCenteredOverlayOffsetAfterScale,
  clampEditorTitleFontScale,
  clientDeltaToCanvas,
  clientRectToCanvas,
  createEditorTextOverlay,
  createInitialEditorOverlayLayout,
  consolidateEditorTitleFontScale,
  editorOverlayZIndex,
  editorOverlayContainerStyle,
  editorOverlayLayoutsEqual,
  lockEditorTitleHorizontalOffset,
  moveEditorOverlayOrderItem,
  normalizeEditorOverlayLayerOrder,
  normalizeEditorTitleScaleLayout,
  pinEditorChannelLayerOnTop,
  pinEditorTitleAboveVideo,
  recordEditorOverlayHistory,
  redoEditorOverlayHistory,
  resetEditorOverlayGeometry,
  resizeEditorTextOverlayWidth,
  resizeCanvasRectFromCorner,
  snapCommentToVideoBottom,
  snapRectCenterToCanvas,
  snapRectToOverlayRects,
  snapResizedCanvasRectToCanvas,
  undoEditorOverlayHistory,
} from "@/lib/editor-overlay-preview";

describe("editor overlay preview geometry", () => {
  it("uses one bounded title size for both editor controls", () => {
    expect(consolidateEditorTitleFontScale(1.2, 1.4)).toBeCloseTo(1.68);
    expect(consolidateEditorTitleFontScale(2, 2)).toBe(2);
    expect(consolidateEditorTitleFontScale(0.5, 0.5)).toBe(0.5);
    expect(clampEditorTitleFontScale(Number.NaN)).toBe(1);

    const layout = createInitialEditorOverlayLayout();
    layout.scales.title = 1.35;
    const normalized = normalizeEditorTitleScaleLayout(layout);
    expect(normalized.scales.title).toBe(1);
    expect(layout.scales.title).toBe(1.35);
  });

  it("keeps the hook title horizontally fixed while preserving its vertical offset", () => {
    expect(lockEditorTitleHorizontalOffset({ x: 184, y: -27 })).toEqual({
      x: 0,
      y: -27,
    });
  });

  it("repositions a scaled centered overlay before it can leave the canvas", () => {
    const result = clampCenteredOverlayOffsetAfterScale({
      layerRect: { x: 368, y: 80, width: 712, height: 160 },
      offset: { x: 184, y: 0 },
      currentScale: 1,
      nextScale: 1.4,
    });
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it("centers an overlay axis when the scaled layer is larger than the canvas", () => {
    expect(clampCenteredOverlayOffsetAfterScale({
      layerRect: { x: 200, y: 700, width: 880, height: 200 },
      offset: { x: 100, y: 0 },
      currentScale: 1,
      nextScale: 2,
    })).toEqual({ x: 0, y: 0 });
  });

  it("applies one font to every dropdown-selectable text layer", () => {
    const layout = createInitialEditorOverlayLayout();
    layout.fonts.title = "do-hyeon";
    layout.fonts.channel = "noto-serif-kr";
    layout.textOverlays = [
      createEditorTextOverlay("first", 10),
      {
        ...createEditorTextOverlay("second", 10),
        fontId: "black-han-sans",
      },
    ];

    const applied = applyEditorFontToSelectableText(layout, "suit");

    expect(applied.fonts).toEqual({ title: "suit", channel: "suit" });
    expect(applied.textOverlays.map((textOverlay) => textOverlay.fontId)).toEqual([
      "suit",
      "suit",
    ]);
    expect(layout.fonts).toEqual({
      title: "do-hyeon",
      channel: "noto-serif-kr",
    });
  });

  it("maps client movement and rectangles to the 1080 by 1920 canvas", () => {
    expect(clientDeltaToCanvas(
      { x: 18, y: 32 },
      { width: 360, height: 640 },
    )).toEqual({ x: 54, y: 96 });
    expect(clientRectToCanvas(
      { x: 120, y: 220, width: 180, height: 160 },
      { x: 60, y: 60, width: 360, height: 640 },
    )).toEqual({ x: 180, y: 480, width: 540, height: 480 });
  });

  it("keeps movable layers inside the canvas", () => {
    const rect = { x: 100, y: 200, width: 500, height: 600 };
    expect(clampCanvasDelta(rect, { x: -300, y: 1_500 })).toEqual({
      x: -100,
      y: 1_120,
    });
    expect(clampCanvasDelta(rect, { x: 200, y: -300 }, "vertical")).toEqual({
      x: 0,
      y: -200,
    });
    expect(clampCanvasDelta(
      { x: -100, y: 200, width: 1_280, height: 600 },
      { x: 300, y: 0 },
    )).toEqual({
      x: 100,
      y: 0,
    });
  });

  it("snaps layer centers to each canvas axis independently", () => {
    const rect = { x: 400, y: 500, width: 260, height: 400 };
    expect(snapRectCenterToCanvas(rect, { x: 8, y: 50 }, 10)).toEqual({
      delta: { x: 10, y: 50 },
      guides: { x: true, y: false },
    });
  });

  it("snaps the comment top edge to the current video bottom", () => {
    const rect = { x: 0, y: 1_090, width: 1_080, height: 260 };
    expect(snapCommentToVideoBottom(rect, -8, 1_080, 5)).toEqual({
      deltaY: -10,
      snapped: true,
    });
    expect(snapCommentToVideoBottom(rect, 20, 1_080, 5)).toEqual({
      deltaY: 20,
      snapped: false,
    });
  });

  it("snaps a moving video to the nearest overlay edges on both axes", () => {
    expect(snapRectToOverlayRects(
      { x: 100, y: 200, width: 400, height: 300 },
      { x: 7, y: -5 },
      [{ x: 510, y: 500, width: 300, height: 200 }],
      12,
    )).toEqual({
      delta: { x: 10, y: 0 },
      guides: { overlayX: 510, overlayY: 500 },
    });
  });

  it("does not snap a moving video outside the overlay threshold", () => {
    expect(snapRectToOverlayRects(
      { x: 100, y: 200, width: 400, height: 300 },
      { x: -30, y: -30 },
      [{ x: 510, y: 500, width: 300, height: 200 }],
      12,
    )).toEqual({
      delta: { x: -30, y: -30 },
      guides: { overlayX: null, overlayY: null },
    });
  });

  it("resizes an added-text box from either side while anchoring the other edge", () => {
    expect(resizeEditorTextOverlayWidth({
      width: 600,
      offsetX: 0,
      deltaX: 120,
      edge: "right",
    })).toEqual({
      width: 720,
      offsetX: 60,
    });
    expect(resizeEditorTextOverlayWidth({
      width: 600,
      offsetX: 0,
      deltaX: -120,
      edge: "left",
    })).toEqual({
      width: 720,
      offsetX: -60,
    });
  });

  it("keeps an added-text box inside its width limits", () => {
    expect(resizeEditorTextOverlayWidth({
      width: 300,
      offsetX: 25,
      deltaX: 200,
      edge: "left",
      minimumWidth: 260,
      maximumWidth: 1_000,
    })).toEqual({
      width: 260,
      offsetX: 45,
    });
  });

  it("lets an added-text box collapse to the technical minimum by default", () => {
    expect(resizeEditorTextOverlayWidth({
      width: 300,
      offsetX: 0,
      deltaX: 500,
      edge: "left",
    })).toEqual({
      width: 1,
      offsetX: 149.5,
    });
  });

  it("resizes from a corner while preserving the opposite anchor and aspect ratio", () => {
    expect(resizeCanvasRectFromCorner({
      rect: { x: 100, y: 200, width: 400, height: 300 },
      delta: { x: 200, y: 150 },
      handle: "bottom-right",
      minimumWidth: 100,
      minimumHeight: 75,
    })).toEqual({
      rect: { x: 100, y: 200, width: 600, height: 450 },
      scaleFactor: 1.5,
    });
    expect(resizeCanvasRectFromCorner({
      rect: { x: 100, y: 200, width: 400, height: 300 },
      delta: { x: 100, y: 75 },
      handle: "top-left",
      minimumWidth: 100,
      minimumHeight: 75,
    })).toEqual({
      rect: { x: 200, y: 275, width: 300, height: 225 },
      scaleFactor: 0.75,
    });
  });

  it("limits video resizing to the canvas and configured minimum size", () => {
    const canvasBounded = resizeCanvasRectFromCorner({
      rect: { x: 100, y: 200, width: 400, height: 300 },
      delta: { x: 2_000, y: 1_500 },
      handle: "bottom-right",
      minimumWidth: 200,
      minimumHeight: 150,
    });
    expect(canvasBounded.scaleFactor).toBeCloseTo(2.45);
    expect(canvasBounded.rect.x).toBeCloseTo(100);
    expect(canvasBounded.rect.y).toBeCloseTo(200);
    expect(canvasBounded.rect.width).toBeCloseTo(980);
    expect(canvasBounded.rect.height).toBeCloseTo(735);
    expect(resizeCanvasRectFromCorner({
      rect: { x: 100, y: 200, width: 400, height: 300 },
      delta: { x: -400, y: -300 },
      handle: "bottom-right",
      minimumWidth: 200,
      minimumHeight: 150,
    })).toEqual({
      rect: { x: 100, y: 200, width: 200, height: 150 },
      scaleFactor: 0.5,
    });
  });

  it("can intentionally enlarge video beyond the canvas up to a scale cap", () => {
    expect(resizeCanvasRectFromCorner({
      rect: { x: 0, y: 400, width: 1_080, height: 608 },
      delta: { x: 1_080, y: 608 },
      handle: "bottom-right",
      minimumWidth: 270,
      minimumHeight: 152,
      allowOverflow: true,
      maximumScaleFactor: 2,
    })).toEqual({
      rect: { x: 0, y: 400, width: 2_160, height: 1_216 },
      scaleFactor: 2,
    });
  });

  it("magnetically fits video width and height to the preview canvas", () => {
    expect(snapResizedCanvasRectToCanvas({
      initialRect: { x: 100, y: 200, width: 540, height: 960 },
      resized: {
        rect: { x: 100, y: 200, width: 1_074, height: 1_909.3333333333 },
        scaleFactor: 1.9888888889,
      },
      handle: "bottom-right",
      threshold: 12,
      maximumScaleFactor: 2,
    })).toEqual({
      rect: { x: 100, y: 200, width: 1_080, height: 1_920 },
      scaleFactor: 2,
      snapped: { width: true, height: true },
    });
  });

  it("only magnetically fits video size inside the snap threshold", () => {
    const resized = {
      rect: { x: 100, y: 200, width: 1_050, height: 590.625 },
      scaleFactor: 1.3125,
    };
    expect(snapResizedCanvasRectToCanvas({
      initialRect: { x: 100, y: 200, width: 800, height: 450 },
      resized,
      handle: "bottom-right",
      threshold: 12,
      maximumScaleFactor: 2,
    })).toEqual({
      ...resized,
      snapped: { width: false, height: false },
    });
  });

  it("preserves the opposite resize anchor when fitting video height", () => {
    expect(snapResizedCanvasRectToCanvas({
      initialRect: { x: 300, y: 500, width: 500, height: 1_000 },
      resized: {
        rect: { x: -155, y: -410, width: 955, height: 1_910 },
        scaleFactor: 1.91,
      },
      handle: "top-left",
      threshold: 12,
      maximumScaleFactor: 2,
    })).toEqual({
      rect: { x: -160, y: -420, width: 960, height: 1_920 },
      scaleFactor: 1.92,
      snapped: { width: false, height: true },
    });
  });

  it("records one local history step and traverses undo and redo snapshots", () => {
    const initial = createInitialEditorOverlayLayout();
    const moved = createInitialEditorOverlayLayout();
    moved.offsets.channel = { x: 80, y: -40 };
    moved.scales.title = 1.25;
    const recorded = recordEditorOverlayHistory(
      { past: [], future: [] },
      initial,
      moved,
    );
    const undone = undoEditorOverlayHistory(recorded, moved);
    expect(undone.layout).toEqual(initial);
    expect(undone.history.past).toHaveLength(0);
    expect(undone.history.future).toEqual([moved]);

    const redone = redoEditorOverlayHistory(
      undone.history,
      undone.layout || initial,
    );
    expect(redone.layout).toEqual(moved);
    expect(redone.history.past).toEqual([initial]);
    expect(redone.history.future).toHaveLength(0);
  });

  it("moves overlay layers one step forward or backward without leaving bounds", () => {
    const order = ["video", "title", "comment", "channel"] as const;
    expect(moveEditorOverlayOrderItem([...order], "title", "forward")).toEqual([
      "video",
      "comment",
      "title",
      "channel",
    ]);
    expect(moveEditorOverlayOrderItem([...order], "video", "backward")).toEqual(order);
    expect(moveEditorOverlayOrderItem([...order], "channel", "forward")).toEqual(order);
    expect(moveEditorOverlayOrderItem([...order], "channel", "backward")).toEqual(order);
    expect(moveEditorOverlayOrderItem(
      [...order],
      "title",
      "forward",
      ["video", "title", "channel"],
    )).toEqual(order);
  });

  it("keeps the channel layer at the very front", () => {
    expect(pinEditorChannelLayerOnTop([
      "channel",
      "video",
      "text:one",
      "title",
      "comment",
    ])).toEqual([
      "video",
      "text:one",
      "title",
      "comment",
      "channel",
    ]);
  });

  it("keeps the hook title in front of a full-canvas video", () => {
    expect(pinEditorTitleAboveVideo([
      "title",
      "comment",
      "video",
      "channel",
    ])).toEqual([
      "video",
      "title",
      "comment",
      "channel",
    ]);
    expect(normalizeEditorOverlayLayerOrder([
      "channel",
      "title",
      "video",
      "comment",
    ])).toEqual([
      "video",
      "title",
      "comment",
      "channel",
    ]);
    expect(editorOverlayZIndex([
      "title",
      "comment",
      "video",
      "channel",
    ], "title")).toBeGreaterThan(editorOverlayZIndex([
      "title",
      "comment",
      "video",
      "channel",
    ], "video"));
    expect(editorOverlayContainerStyle(20)).toEqual({
      containerType: "inline-size",
      zIndex: 20,
    });
  });

  it("does not let video and title layer controls cross each other", () => {
    const order = ["video", "title", "comment", "channel"] as const;
    expect(moveEditorOverlayOrderItem([...order], "video", "forward"))
      .toEqual(order);
    expect(moveEditorOverlayOrderItem([...order], "title", "backward"))
      .toEqual(order);
  });

  it("clears redo history after a new edit and caps stored snapshots", () => {
    const initial = createInitialEditorOverlayLayout();
    const older = createInitialEditorOverlayLayout();
    older.offsets.title.x = 10;
    const moved = createInitialEditorOverlayLayout();
    moved.offsets.video.x = 20;
    const resized = createInitialEditorOverlayLayout();
    resized.scales.video = 1.2;
    const history = recordEditorOverlayHistory(
      { past: [initial, older], future: [resized] },
      moved,
      resized,
      2,
    );
    expect(history.past).toEqual([older, moved]);
    expect(history.future).toEqual([]);
  });

  it("keeps added text and deleted built-in overlays in local history snapshots", () => {
    const initial = createInitialEditorOverlayLayout();
    const edited = createInitialEditorOverlayLayout();
    edited.visible.title = false;
    edited.textOverlays = [createEditorTextOverlay("local-text", 12)];
    edited.layerOrder.push("text:local-text");
    edited.textOverlays[0].color = "#FFD84D";
    edited.textOverlays[0].endSeconds = 7.5;

    const history = recordEditorOverlayHistory(
      { past: [], future: [] },
      initial,
      edited,
    );
    edited.textOverlays[0].text = "나중에 바뀐 값";

    const undone = undoEditorOverlayHistory(history, edited);
    expect(undone.layout).toEqual(initial);
    const redone = redoEditorOverlayHistory(
      undone.history,
      undone.layout || initial,
    );
    expect(redone.layout?.visible.title).toBe(false);
    expect(redone.layout?.textOverlays[0]).toMatchObject({
      id: "local-text",
      color: "#FFD84D",
      effect: "outline",
      endSeconds: 7.5,
      text: "나중에 바뀐 값",
    });
    expect(redone.layout?.layerOrder.at(-2)).toBe("text:local-text");
    expect(redone.layout?.layerOrder.at(-1)).toBe("channel");
  });

  it("resets template-dependent geometry without deleting editor content or styles", () => {
    const edited = createInitialEditorOverlayLayout();
    edited.offsets.video = { x: 80, y: -120 };
    edited.offsets.title = { x: -40, y: 60 };
    edited.offsets.comment = { x: 0, y: 180 };
    edited.offsets.channel = { x: 20, y: -30 };
    edited.commentOffsets = {
      "comment-1": { x: 0, y: 180 },
    };
    edited.scales = {
      video: 1.4,
      title: 1.2,
      channel: 0.9,
    };
    edited.fonts = {
      title: "black-han-sans",
      channel: "spoqa-han-sans-neo",
    };
    edited.visible.comment = false;
    edited.commentTheme = "light";
    edited.background = {
      kind: "image",
      assetId: "news-red-globe",
    };
    edited.textOverlays = [createEditorTextOverlay("local-text", 12)];
    edited.textOverlays[0].offset = { x: 45, y: 70 };
    edited.textOverlays[0].scale = 1.35;
    edited.layerOrder.push("text:local-text");

    const reset = resetEditorOverlayGeometry(edited);

    expect(reset.offsets).toEqual(createInitialEditorOverlayLayout().offsets);
    expect(reset.commentOffsets).toEqual({});
    expect(reset.scales).toEqual(createInitialEditorOverlayLayout().scales);
    expect(reset.fonts).toEqual(edited.fonts);
    expect(reset.visible).toEqual(edited.visible);
    expect(reset.commentTheme).toBe("light");
    expect(reset.background).toEqual(edited.background);
    expect(reset.layerOrder).toEqual(
      pinEditorChannelLayerOnTop(edited.layerOrder),
    );
    expect(reset.textOverlays).toEqual(edited.textOverlays);
    expect(reset.textOverlays[0]).not.toBe(edited.textOverlays[0]);
  });

  it("keeps a locally selected canvas background in undo and redo history", () => {
    const initial = createInitialEditorOverlayLayout();
    const edited = createInitialEditorOverlayLayout();
    edited.background = {
      kind: "image",
      assetId: "white-grid",
    };

    expect(editorOverlayLayoutsEqual(initial, edited)).toBe(false);
    const history = recordEditorOverlayHistory(
      { past: [], future: [] },
      initial,
      edited,
    );
    const undone = undoEditorOverlayHistory(history, edited);
    expect(undone.layout?.background).toBeNull();

    const redone = redoEditorOverlayHistory(
      undone.history,
      undone.layout || initial,
    );
    expect(redone.layout?.background).toEqual({
      kind: "image",
      assetId: "white-grid",
    });
  });

  it("compares text overlay contents and visibility", () => {
    const left = createInitialEditorOverlayLayout();
    const right = createInitialEditorOverlayLayout();
    expect(editorOverlayLayoutsEqual(left, right)).toBe(true);
    right.textOverlays.push(createEditorTextOverlay("text", 5));
    expect(editorOverlayLayoutsEqual(left, right)).toBe(false);
    left.textOverlays.push(createEditorTextOverlay("text", 5));
    expect(editorOverlayLayoutsEqual(left, right)).toBe(true);
    right.textOverlays[0].effect = "shadow";
    expect(editorOverlayLayoutsEqual(left, right)).toBe(false);
    right.textOverlays[0].effect = "none";
    expect(editorOverlayLayoutsEqual(left, right)).toBe(false);
    right.textOverlays[0].effect = "outline";
    right.visible.video = false;
    expect(editorOverlayLayoutsEqual(left, right)).toBe(false);
  });

  it("uses a real text outline as the default added-text effect", () => {
    expect(createEditorTextOverlay("outlined", 5).effect).toBe("outline");
  });

  it("keeps title, channel, and added-text fonts in undo and redo history", () => {
    const initial = createInitialEditorOverlayLayout();
    const edited = createInitialEditorOverlayLayout();
    edited.fonts.title = "black-han-sans";
    edited.fonts.channel = "spoqa-han-sans-neo";
    edited.textOverlays = [createEditorTextOverlay("font-text", 5)];
    edited.textOverlays[0].fontId = "nanum-myeongjo";

    expect(editorOverlayLayoutsEqual(initial, edited)).toBe(false);
    const history = recordEditorOverlayHistory(
      { past: [], future: [] },
      initial,
      edited,
    );
    const undone = undoEditorOverlayHistory(history, edited);
    expect(undone.layout?.fonts).toEqual({
      title: "pretendard",
      channel: "pretendard",
    });

    const redone = redoEditorOverlayHistory(
      undone.history,
      undone.layout || initial,
    );
    expect(redone.layout?.fonts).toEqual({
      title: "black-han-sans",
      channel: "spoqa-han-sans-neo",
    });
    expect(redone.layout?.textOverlays[0].fontId).toBe("nanum-myeongjo");
  });

  it("keeps the local comment theme in undo and redo history", () => {
    const initial = createInitialEditorOverlayLayout();
    const themed = createInitialEditorOverlayLayout();
    themed.commentTheme = "light";

    const history = recordEditorOverlayHistory(
      { past: [], future: [] },
      initial,
      themed,
    );
    const undone = undoEditorOverlayHistory(history, themed);
    expect(undone.layout?.commentTheme).toBeNull();

    const redone = redoEditorOverlayHistory(
      undone.history,
      undone.layout || initial,
    );
    expect(redone.layout?.commentTheme).toBe("light");
  });

  it("keeps individual and bulk-applied comment positions in history", () => {
    const individuallyMoved = createInitialEditorOverlayLayout();
    individuallyMoved.commentOffsets["comment-1"] = { x: 0, y: 180 };
    const bulkApplied = createInitialEditorOverlayLayout();
    bulkApplied.offsets.comment = { x: 0, y: 180 };
    bulkApplied.commentOffsets = {
      "comment-1": { x: 0, y: 180 },
      "comment-2": { x: 0, y: 180 },
    };

    expect(editorOverlayLayoutsEqual(
      createInitialEditorOverlayLayout(),
      individuallyMoved,
    )).toBe(false);
    const history = recordEditorOverlayHistory(
      { past: [], future: [] },
      individuallyMoved,
      bulkApplied,
    );
    const undone = undoEditorOverlayHistory(history, bulkApplied);
    expect(undone.layout?.commentOffsets).toEqual({
      "comment-1": { x: 0, y: 180 },
    });

    const redone = redoEditorOverlayHistory(
      undone.history,
      undone.layout || individuallyMoved,
    );
    expect(redone.layout?.offsets.comment).toEqual({ x: 0, y: 180 });
    expect(redone.layout?.commentOffsets).toEqual({
      "comment-1": { x: 0, y: 180 },
      "comment-2": { x: 0, y: 180 },
    });
  });
});
