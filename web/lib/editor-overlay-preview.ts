import {
  TEMPLATE_CANVAS,
  type StockBackgroundId,
  type TemplatePresetColor,
} from "@/lib/template-config";
import {
  DEFAULT_EDITOR_FONT_ID,
  isStableEditorFontId,
  type EditorFontId,
} from "@/lib/editor-fonts";

export type EditorOverlayLayer = "video" | "title" | "comment" | "channel";
export type EditorOverlayOrderItem = EditorOverlayLayer | `text:${string}`;
export type EditorCommentTheme = "dark" | "light";
export type EditorTextEffect = "none" | "outline" | "shadow";
export type EditorTextResizeEdge = "left" | "right";
export const EDITOR_TEXT_DEFAULT_WIDTH = 780;
export const EDITOR_TITLE_FONT_SCALE_MIN = 0.5;
export const EDITOR_TITLE_FONT_SCALE_MAX = 2;
// Keep only a technical positive-width guard; the editor should not impose a
// visible minimum when users narrow an added-text box.
export const EDITOR_TEXT_MIN_WIDTH = 1;
export const EDITOR_TEXT_MAX_WIDTH = 1_000;
export type EditorCanvasBackground =
  | { kind: "color"; color: TemplatePresetColor }
  | { kind: "image"; assetId: StockBackgroundId }
  | { kind: "uploaded_image"; assetId: string };

export type EditorVideoResizeHandle =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasRect = CanvasPoint & {
  width: number;
  height: number;
};

export type EditorOverlayOffsets = Record<EditorOverlayLayer, CanvasPoint>;

export type EditorOverlayScales = {
  video: number;
  title: number;
  channel: number;
};

export type EditorTextOverlay = {
  id: string;
  text: string;
  fontId: EditorFontId;
  color: TemplatePresetColor;
  effect: EditorTextEffect;
  offset: CanvasPoint;
  width: number;
  scale: number;
  startSeconds: number;
  endSeconds: number;
};

export type EditorOverlayLayoutSnapshot = {
  offsets: EditorOverlayOffsets;
  commentOffsets: Record<string, CanvasPoint>;
  scales: EditorOverlayScales;
  fonts: {
    title: EditorFontId;
    channel: EditorFontId;
  };
  visible: Record<EditorOverlayLayer, boolean>;
  commentTheme: EditorCommentTheme | null;
  textOverlays: EditorTextOverlay[];
  layerOrder: EditorOverlayOrderItem[];
  background: EditorCanvasBackground | null;
};

export type EditorOverlayHistory = {
  past: EditorOverlayLayoutSnapshot[];
  future: EditorOverlayLayoutSnapshot[];
};

export type EditorOverlayGuides = {
  x: boolean;
  y: boolean;
  commentDocked: boolean;
  overlayX: number | null;
  overlayY: number | null;
  videoWidthFitted: boolean;
  videoHeightFitted: boolean;
};

export const EMPTY_EDITOR_OVERLAY_GUIDES: EditorOverlayGuides = {
  x: false,
  y: false,
  commentDocked: false,
  overlayX: null,
  overlayY: null,
  videoWidthFitted: false,
  videoHeightFitted: false,
};

export function createEmptyEditorOverlayOffsets(): EditorOverlayOffsets {
  return {
    video: { x: 0, y: 0 },
    title: { x: 0, y: 0 },
    comment: { x: 0, y: 0 },
    channel: { x: 0, y: 0 },
  };
}

export function createInitialEditorOverlayLayout(): EditorOverlayLayoutSnapshot {
  return {
    offsets: createEmptyEditorOverlayOffsets(),
    commentOffsets: {},
    scales: {
      video: 1,
      title: 1,
      channel: 1,
    },
    fonts: {
      title: DEFAULT_EDITOR_FONT_ID,
      channel: DEFAULT_EDITOR_FONT_ID,
    },
    visible: {
      video: true,
      title: true,
      comment: true,
      channel: true,
    },
    commentTheme: null,
    textOverlays: [],
    layerOrder: ["video", "title", "comment", "channel"],
    background: null,
  };
}

export function pinEditorChannelLayerOnTop(
  order: EditorOverlayOrderItem[],
): EditorOverlayOrderItem[] {
  return [
    ...order.filter((item) => item !== "channel"),
    "channel",
  ];
}

export function pinEditorTitleAboveVideo(
  order: EditorOverlayOrderItem[],
): EditorOverlayOrderItem[] {
  const videoIndex = order.indexOf("video");
  const titleIndex = order.indexOf("title");
  if (videoIndex < 0 || titleIndex < 0 || videoIndex < titleIndex) {
    return [...order];
  }
  const next: EditorOverlayOrderItem[] = order.filter(
    (item) => item !== "video",
  );
  next.splice(next.indexOf("title"), 0, "video");
  return next;
}

export function normalizeEditorOverlayLayerOrder(
  order: EditorOverlayOrderItem[],
): EditorOverlayOrderItem[] {
  return pinEditorChannelLayerOnTop(pinEditorTitleAboveVideo(order));
}

export function editorOverlayZIndex(
  order: EditorOverlayOrderItem[],
  item: EditorOverlayOrderItem,
  pinTitleAboveVideo = false,
): number {
  const normalizedOrder = pinTitleAboveVideo
    ? normalizeEditorOverlayLayerOrder(order)
    : pinEditorChannelLayerOnTop(order);
  const index = normalizedOrder.indexOf(item);
  return 10 + Math.max(0, index) * 10;
}

export function editorOverlayContainerStyle(
  zIndex: string | number | undefined,
): { containerType: "inline-size"; zIndex: string | number | undefined } {
  return {
    containerType: "inline-size",
    zIndex,
  };
}

export function createEditorTextOverlay(
  id: string,
  durationSeconds: number,
): EditorTextOverlay {
  return {
    id,
    text: "텍스트를 입력하세요",
    fontId: DEFAULT_EDITOR_FONT_ID,
    color: "#FFFFFF",
    effect: "outline",
    offset: { x: 0, y: 0 },
    width: EDITOR_TEXT_DEFAULT_WIDTH,
    scale: 1,
    startSeconds: 0,
    endSeconds: Math.max(0.3, durationSeconds),
  };
}

export function cloneEditorOverlayLayout(
  layout: EditorOverlayLayoutSnapshot,
  pinTitleAboveVideo = false,
): EditorOverlayLayoutSnapshot {
  return {
    offsets: {
      video: { ...layout.offsets.video },
      title: { ...layout.offsets.title },
      comment: { ...layout.offsets.comment },
      channel: { ...layout.offsets.channel },
    },
    commentOffsets: Object.fromEntries(
      Object.entries(layout.commentOffsets || {}).map(([id, offset]) => [
        id,
        { ...offset },
      ]),
    ),
    scales: { ...layout.scales },
    fonts: {
      title: layout.fonts?.title || DEFAULT_EDITOR_FONT_ID,
      channel: layout.fonts?.channel || DEFAULT_EDITOR_FONT_ID,
    },
    visible: { ...layout.visible },
    commentTheme: layout.commentTheme,
    textOverlays: layout.textOverlays.map((textOverlay) => ({
      ...textOverlay,
      offset: { ...textOverlay.offset },
    })),
    layerOrder: pinTitleAboveVideo
      ? normalizeEditorOverlayLayerOrder(layout.layerOrder)
      : pinEditorChannelLayerOnTop(layout.layerOrder),
    background: layout.background ? { ...layout.background } : null,
  };
}

export function sanitizeEditorOverlayFontsForStable(
  layout: EditorOverlayLayoutSnapshot,
): EditorOverlayLayoutSnapshot {
  const next = cloneEditorOverlayLayout(layout);
  next.fonts = {
    title: isStableEditorFontId(next.fonts.title)
      ? next.fonts.title
      : DEFAULT_EDITOR_FONT_ID,
    channel: isStableEditorFontId(next.fonts.channel)
      ? next.fonts.channel
      : DEFAULT_EDITOR_FONT_ID,
  };
  next.textOverlays = next.textOverlays.map((textOverlay) => ({
    ...textOverlay,
    fontId: isStableEditorFontId(textOverlay.fontId)
      ? textOverlay.fontId
      : DEFAULT_EDITOR_FONT_ID,
  }));
  return next;
}

export function clampEditorTitleFontScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(
    EDITOR_TITLE_FONT_SCALE_MAX,
    Math.max(EDITOR_TITLE_FONT_SCALE_MIN, scale),
  );
}

/**
 * Older editor documents could apply title sizing twice: once through
 * title.fontScale and again through overlays.scales.title. Keep their visible
 * size when loading them, but collapse the two controls into one canonical
 * title font scale for every new snapshot.
 */
export function consolidateEditorTitleFontScale(
  fontScale: number,
  legacyOverlayScale: number,
): number {
  const safeFontScale = Number.isFinite(fontScale) ? fontScale : 1;
  const safeOverlayScale = Number.isFinite(legacyOverlayScale)
    ? legacyOverlayScale
    : 1;
  return clampEditorTitleFontScale(safeFontScale * safeOverlayScale);
}

export function normalizeEditorTitleScaleLayout(
  layout: EditorOverlayLayoutSnapshot,
): EditorOverlayLayoutSnapshot {
  const next = cloneEditorOverlayLayout(layout);
  next.scales.title = 1;
  return next;
}

export function applyEditorFontToSelectableText(
  layout: EditorOverlayLayoutSnapshot,
  fontId: EditorFontId,
): EditorOverlayLayoutSnapshot {
  return {
    ...layout,
    fonts: {
      title: fontId,
      channel: fontId,
    },
    textOverlays: layout.textOverlays.map((textOverlay) => ({
      ...textOverlay,
      fontId,
    })),
  };
}

export function resetEditorOverlayGeometry(
  layout: EditorOverlayLayoutSnapshot,
): EditorOverlayLayoutSnapshot {
  const initial = createInitialEditorOverlayLayout();
  const next = cloneEditorOverlayLayout(layout);
  next.offsets = initial.offsets;
  next.commentOffsets = initial.commentOffsets;
  next.scales = initial.scales;
  return next;
}

export function editorOverlayLayoutsEqual(
  left: EditorOverlayLayoutSnapshot,
  right: EditorOverlayLayoutSnapshot,
) {
  const leftCommentOffsets = left.commentOffsets || {};
  const rightCommentOffsets = right.commentOffsets || {};
  const leftCommentOffsetIds = Object.keys(leftCommentOffsets);
  const rightCommentOffsetIds = Object.keys(rightCommentOffsets);
  const commentOffsetsEqual = leftCommentOffsetIds.length === rightCommentOffsetIds.length
    && leftCommentOffsetIds.every((id) => (
      leftCommentOffsets[id]?.x === rightCommentOffsets[id]?.x
      && leftCommentOffsets[id]?.y === rightCommentOffsets[id]?.y
    ));
  return (
    left.offsets.video.x === right.offsets.video.x
    && left.offsets.video.y === right.offsets.video.y
    && left.offsets.title.x === right.offsets.title.x
    && left.offsets.title.y === right.offsets.title.y
    && left.offsets.comment.x === right.offsets.comment.x
    && left.offsets.comment.y === right.offsets.comment.y
    && left.offsets.channel.x === right.offsets.channel.x
    && left.offsets.channel.y === right.offsets.channel.y
    && commentOffsetsEqual
    && left.scales.video === right.scales.video
    && left.scales.title === right.scales.title
    && left.scales.channel === right.scales.channel
    && (left.fonts?.title || DEFAULT_EDITOR_FONT_ID)
      === (right.fonts?.title || DEFAULT_EDITOR_FONT_ID)
    && (left.fonts?.channel || DEFAULT_EDITOR_FONT_ID)
      === (right.fonts?.channel || DEFAULT_EDITOR_FONT_ID)
    && left.visible.video === right.visible.video
    && left.visible.title === right.visible.title
    && left.visible.comment === right.visible.comment
    && left.visible.channel === right.visible.channel
    && left.commentTheme === right.commentTheme
    && left.background?.kind === right.background?.kind
    && (
      left.background?.kind !== "color"
      || right.background?.kind !== "color"
      || left.background.color === right.background.color
    )
    && (
      left.background?.kind !== "image"
      || right.background?.kind !== "image"
      || left.background.assetId === right.background.assetId
    )
    && (
      left.background?.kind !== "uploaded_image"
      || right.background?.kind !== "uploaded_image"
      || left.background.assetId === right.background.assetId
    )
    && left.layerOrder.length === right.layerOrder.length
    && left.layerOrder.every((item, index) => item === right.layerOrder[index])
    && left.textOverlays.length === right.textOverlays.length
    && left.textOverlays.every((textOverlay, index) => {
      const other = right.textOverlays[index];
      return Boolean(
        other
        && textOverlay.id === other.id
        && textOverlay.text === other.text
        && (textOverlay.fontId || DEFAULT_EDITOR_FONT_ID)
          === (other.fontId || DEFAULT_EDITOR_FONT_ID)
        && textOverlay.color === other.color
        && textOverlay.effect === other.effect
        && textOverlay.offset.x === other.offset.x
        && textOverlay.offset.y === other.offset.y
        && (textOverlay.width ?? EDITOR_TEXT_DEFAULT_WIDTH)
          === (other.width ?? EDITOR_TEXT_DEFAULT_WIDTH)
        && textOverlay.scale === other.scale
        && textOverlay.startSeconds === other.startSeconds
        && textOverlay.endSeconds === other.endSeconds
      );
    })
  );
}

export function moveEditorOverlayOrderItem(
  order: EditorOverlayOrderItem[],
  item: EditorOverlayOrderItem,
  direction: "forward" | "backward",
  visibleOrder: EditorOverlayOrderItem[] = order,
  pinTitleAboveVideo = false,
): EditorOverlayOrderItem[] {
  if (item === "channel") return order;
  const currentIndex = order.indexOf(item);
  const visibleIndex = visibleOrder.indexOf(item);
  if (currentIndex < 0 || visibleIndex < 0) return order;
  const adjacentVisibleIndex = direction === "forward"
    ? Math.min(visibleOrder.length - 1, visibleIndex + 1)
    : Math.max(0, visibleIndex - 1);
  if (adjacentVisibleIndex === visibleIndex) return order;
  if (visibleOrder[adjacentVisibleIndex] === "channel") return order;
  const nextIndex = order.indexOf(visibleOrder[adjacentVisibleIndex]);
  if (nextIndex < 0) return order;
  const next = [...order];
  [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
  return pinTitleAboveVideo
    ? normalizeEditorOverlayLayerOrder(next)
    : pinEditorChannelLayerOnTop(next);
}

export function recordEditorOverlayHistory(
  history: EditorOverlayHistory,
  before: EditorOverlayLayoutSnapshot,
  after: EditorOverlayLayoutSnapshot,
  maximumEntries = 100,
): EditorOverlayHistory {
  if (editorOverlayLayoutsEqual(before, after)) return history;
  return {
    past: [
      ...history.past,
      cloneEditorOverlayLayout(before),
    ].slice(-maximumEntries),
    future: [],
  };
}

export function undoEditorOverlayHistory(
  history: EditorOverlayHistory,
  current: EditorOverlayLayoutSnapshot,
): {
  history: EditorOverlayHistory;
  layout: EditorOverlayLayoutSnapshot | null;
} {
  const layout = history.past.at(-1);
  if (!layout) return { history, layout: null };
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [
        cloneEditorOverlayLayout(current),
        ...history.future,
      ],
    },
    layout: cloneEditorOverlayLayout(layout),
  };
}

export function redoEditorOverlayHistory(
  history: EditorOverlayHistory,
  current: EditorOverlayLayoutSnapshot,
): {
  history: EditorOverlayHistory;
  layout: EditorOverlayLayoutSnapshot | null;
} {
  const [layout, ...future] = history.future;
  if (!layout) return { history, layout: null };
  return {
    history: {
      past: [
        ...history.past,
        cloneEditorOverlayLayout(current),
      ],
      future,
    },
    layout: cloneEditorOverlayLayout(layout),
  };
}

export function clientDeltaToCanvas(
  delta: CanvasPoint,
  canvasSize: { width: number; height: number },
): CanvasPoint {
  if (canvasSize.width <= 0 || canvasSize.height <= 0) return { x: 0, y: 0 };
  return {
    x: Math.round(delta.x * TEMPLATE_CANVAS.width / canvasSize.width),
    y: Math.round(delta.y * TEMPLATE_CANVAS.height / canvasSize.height),
  };
}

export function clientRectToCanvas(
  layerRect: CanvasRect,
  canvasRect: CanvasRect,
): CanvasRect {
  if (canvasRect.width <= 0 || canvasRect.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: (layerRect.x - canvasRect.x) * TEMPLATE_CANVAS.width / canvasRect.width,
    y: (layerRect.y - canvasRect.y) * TEMPLATE_CANVAS.height / canvasRect.height,
    width: layerRect.width * TEMPLATE_CANVAS.width / canvasRect.width,
    height: layerRect.height * TEMPLATE_CANVAS.height / canvasRect.height,
  };
}

export function clientDistanceToCanvas(
  distance: number,
  canvasClientWidth: number,
): number {
  if (canvasClientWidth <= 0) return 0;
  return distance * TEMPLATE_CANVAS.width / canvasClientWidth;
}

export function clampCanvasDelta(
  layerRect: CanvasRect,
  delta: CanvasPoint,
  axis: "both" | "vertical" = "both",
): CanvasPoint {
  const horizontalBounds = layerRect.width <= TEMPLATE_CANVAS.width
    ? {
        minimum: -layerRect.x,
        maximum: TEMPLATE_CANVAS.width - layerRect.x - layerRect.width,
      }
    : {
        minimum: TEMPLATE_CANVAS.width - layerRect.x - layerRect.width,
        maximum: -layerRect.x,
      };
  const verticalBounds = layerRect.height <= TEMPLATE_CANVAS.height
    ? {
        minimum: -layerRect.y,
        maximum: TEMPLATE_CANVAS.height - layerRect.y - layerRect.height,
      }
    : {
        minimum: TEMPLATE_CANVAS.height - layerRect.y - layerRect.height,
        maximum: -layerRect.y,
      };
  return {
    x: axis === "vertical"
      ? 0
      : Math.min(
          horizontalBounds.maximum,
          Math.max(horizontalBounds.minimum, delta.x),
        ),
    y: Math.min(
      verticalBounds.maximum,
      Math.max(verticalBounds.minimum, delta.y),
    ),
  };
}

/**
 * Keep a centered overlay inside the 1080x1920 editor canvas when its scale
 * changes. The supplied rectangle is the element's currently rendered box,
 * including the current scale and offset.
 */
export function clampCenteredOverlayOffsetAfterScale({
  layerRect,
  offset,
  currentScale,
  nextScale,
}: {
  layerRect: CanvasRect;
  offset: CanvasPoint;
  currentScale: number;
  nextScale: number;
}): CanvasPoint {
  if (
    layerRect.width <= 0
    || layerRect.height <= 0
    || currentScale <= 0
    || nextScale <= 0
  ) {
    return { ...offset };
  }
  const ratio = nextScale / currentScale;
  const nextWidth = layerRect.width * ratio;
  const nextHeight = layerRect.height * ratio;
  const nextRect: CanvasRect = {
    x: layerRect.x + (layerRect.width - nextWidth) / 2,
    y: layerRect.y + (layerRect.height - nextHeight) / 2,
    width: nextWidth,
    height: nextHeight,
  };
  const boundedCorrection = clampCanvasDelta(nextRect, { x: 0, y: 0 });
  const overflowsHorizontally = nextRect.x < 0
    || nextRect.x + nextRect.width > TEMPLATE_CANVAS.width;
  const correction = {
    x: overflowsHorizontally
      ? (TEMPLATE_CANVAS.width - nextWidth) / 2 - nextRect.x
      : boundedCorrection.x,
    y: nextHeight > TEMPLATE_CANVAS.height
      ? (TEMPLATE_CANVAS.height - nextHeight) / 2 - nextRect.y
      : boundedCorrection.y,
  };
  return {
    x: offset.x + correction.x,
    y: offset.y + correction.y,
  };
}

export function snapRectCenterToCanvas(
  layerRect: CanvasRect,
  delta: CanvasPoint,
  threshold: number,
): { delta: CanvasPoint; guides: Pick<EditorOverlayGuides, "x" | "y"> } {
  const candidateCenterX = layerRect.x + layerRect.width / 2 + delta.x;
  const candidateCenterY = layerRect.y + layerRect.height / 2 + delta.y;
  const centerX = TEMPLATE_CANVAS.width / 2;
  const centerY = TEMPLATE_CANVAS.height / 2;
  const snapX = Math.abs(candidateCenterX - centerX) <= threshold;
  const snapY = Math.abs(candidateCenterY - centerY) <= threshold;
  return {
    delta: {
      x: snapX ? delta.x + centerX - candidateCenterX : delta.x,
      y: snapY ? delta.y + centerY - candidateCenterY : delta.y,
    },
    guides: { x: snapX, y: snapY },
  };
}

export function snapCommentToVideoBottom(
  commentRect: CanvasRect,
  deltaY: number,
  videoBottom: number,
  threshold: number,
): { deltaY: number; snapped: boolean } {
  const candidateTop = commentRect.y + deltaY;
  const snapped = Math.abs(candidateTop - videoBottom) <= threshold;
  return {
    deltaY: snapped ? deltaY + videoBottom - candidateTop : deltaY,
    snapped,
  };
}

export function snapRectToOverlayRects(
  movingRect: CanvasRect,
  delta: CanvasPoint,
  targetRects: CanvasRect[],
  threshold: number,
): {
  delta: CanvasPoint;
  guides: Pick<EditorOverlayGuides, "overlayX" | "overlayY">;
} {
  // Video-to-overlay snapping is intentionally edge-only. Including overlay
  // centers lets a docked, full-width comment steal the canvas-center snap.
  const movingX = [movingRect.x, movingRect.x + movingRect.width];
  const movingY = [movingRect.y, movingRect.y + movingRect.height];
  let nearestX: { distance: number; adjustment: number; guide: number } | null = null;
  let nearestY: { distance: number; adjustment: number; guide: number } | null = null;

  for (const targetRect of targetRects) {
    const targetX = [targetRect.x, targetRect.x + targetRect.width];
    const targetY = [targetRect.y, targetRect.y + targetRect.height];
    for (const movingAnchor of movingX) {
      for (const targetAnchor of targetX) {
        const adjustment = targetAnchor - (movingAnchor + delta.x);
        const distance = Math.abs(adjustment);
        if (
          distance <= threshold
          && (nearestX === null || distance < nearestX.distance)
        ) {
          nearestX = { distance, adjustment, guide: targetAnchor };
        }
      }
    }
    for (const movingAnchor of movingY) {
      for (const targetAnchor of targetY) {
        const adjustment = targetAnchor - (movingAnchor + delta.y);
        const distance = Math.abs(adjustment);
        if (
          distance <= threshold
          && (nearestY === null || distance < nearestY.distance)
        ) {
          nearestY = { distance, adjustment, guide: targetAnchor };
        }
      }
    }
  }

  return {
    delta: {
      x: delta.x + (nearestX?.adjustment ?? 0),
      y: delta.y + (nearestY?.adjustment ?? 0),
    },
    guides: {
      overlayX: nearestX?.guide ?? null,
      overlayY: nearestY?.guide ?? null,
    },
  };
}

export function snapVideoRectForMove(
  movingRect: CanvasRect,
  delta: CanvasPoint,
  targetRects: CanvasRect[],
  centerThreshold: number,
  overlayThreshold: number,
): {
  delta: CanvasPoint;
  guides: Pick<
    EditorOverlayGuides,
    "x" | "y" | "overlayX" | "overlayY"
  >;
} {
  const centerSnapped = snapRectCenterToCanvas(
    movingRect,
    delta,
    centerThreshold,
  );
  const overlaySnapped = snapRectToOverlayRects(
    movingRect,
    delta,
    targetRects,
    overlayThreshold,
  );
  const overlayXSnapped = overlaySnapped.guides.overlayX !== null;
  const overlayYSnapped = overlaySnapped.guides.overlayY !== null;
  const snappedDelta = {
    x: overlayXSnapped
      ? overlaySnapped.delta.x
      : centerSnapped.delta.x,
    y: overlayYSnapped
      ? overlaySnapped.delta.y
      : centerSnapped.delta.y,
  };
  const finalCenterX = movingRect.x + movingRect.width / 2 + snappedDelta.x;
  const finalCenterY = movingRect.y + movingRect.height / 2 + snappedDelta.y;
  const centeredX = centerSnapped.guides.x
    && Math.abs(finalCenterX - TEMPLATE_CANVAS.width / 2) < 0.001;
  const centeredY = centerSnapped.guides.y
    && Math.abs(finalCenterY - TEMPLATE_CANVAS.height / 2) < 0.001;
  return {
    delta: snappedDelta,
    guides: {
      x: centeredX,
      y: centeredY,
      overlayX: centeredX ? null : overlaySnapped.guides.overlayX,
      overlayY: centeredY ? null : overlaySnapped.guides.overlayY,
    },
  };
}

export function resizeEditorTextOverlayWidth({
  width,
  offsetX,
  deltaX,
  edge,
  minimumWidth = EDITOR_TEXT_MIN_WIDTH,
  maximumWidth = EDITOR_TEXT_MAX_WIDTH,
}: {
  width: number;
  offsetX: number;
  deltaX: number;
  edge: EditorTextResizeEdge;
  minimumWidth?: number;
  maximumWidth?: number;
}): { width: number; offsetX: number } {
  const safeMinimum = Math.max(1, Math.min(minimumWidth, maximumWidth));
  const safeMaximum = Math.max(safeMinimum, maximumWidth);
  const requestedWidth = width + (edge === "right" ? deltaX : -deltaX);
  const nextWidth = Math.min(
    safeMaximum,
    Math.max(safeMinimum, requestedWidth),
  );
  const appliedWidthDelta = nextWidth - width;
  return {
    width: nextWidth,
    offsetX: offsetX + (edge === "right" ? 1 : -1) * appliedWidthDelta / 2,
  };
}

const resizeHandleDirections: Record<EditorVideoResizeHandle, CanvasPoint> = {
  "top-left": { x: -1, y: -1 },
  "top-right": { x: 1, y: -1 },
  "bottom-left": { x: -1, y: 1 },
  "bottom-right": { x: 1, y: 1 },
};

export function resizeCanvasRectFromCorner({
  rect,
  delta,
  handle,
  minimumWidth,
  minimumHeight,
  allowOverflow = false,
  maximumScaleFactor = Number.POSITIVE_INFINITY,
}: {
  rect: CanvasRect;
  delta: CanvasPoint;
  handle: EditorVideoResizeHandle;
  minimumWidth: number;
  minimumHeight: number;
  allowOverflow?: boolean;
  maximumScaleFactor?: number;
}): { rect: CanvasRect; scaleFactor: number } {
  if (rect.width <= 0 || rect.height <= 0) {
    return { rect, scaleFactor: 1 };
  }

  const direction = resizeHandleDirections[handle];
  const cornerVector = {
    x: direction.x * rect.width,
    y: direction.y * rect.height,
  };
  const projectedScale = 1 + (
    delta.x * cornerVector.x + delta.y * cornerVector.y
  ) / (
    rect.width * rect.width + rect.height * rect.height
  );
  const anchorX = direction.x > 0 ? rect.x : rect.x + rect.width;
  const anchorY = direction.y > 0 ? rect.y : rect.y + rect.height;
  const availableWidth = direction.x > 0
    ? TEMPLATE_CANVAS.width - anchorX
    : anchorX;
  const availableHeight = direction.y > 0
    ? TEMPLATE_CANVAS.height - anchorY
    : anchorY;
  const canvasBoundedMaximumScale = Math.max(0, Math.min(
    availableWidth / rect.width,
    availableHeight / rect.height,
  ));
  const maximumScale = allowOverflow
    ? Math.max(0, maximumScaleFactor)
    : canvasBoundedMaximumScale;
  const requestedMinimumScale = Math.max(
    minimumWidth / rect.width,
    minimumHeight / rect.height,
  );
  const minimumScale = Math.min(requestedMinimumScale, maximumScale);
  const scaleFactor = Math.min(
    maximumScale,
    Math.max(minimumScale, projectedScale),
  );
  const width = rect.width * scaleFactor;
  const height = rect.height * scaleFactor;

  return {
    rect: {
      x: direction.x > 0 ? anchorX : anchorX - width,
      y: direction.y > 0 ? anchorY : anchorY - height,
      width,
      height,
    },
    scaleFactor,
  };
}

export function snapResizedCanvasRectToCanvas({
  initialRect,
  resized,
  handle,
  threshold,
  minimumScaleFactor = 0,
  maximumScaleFactor = Number.POSITIVE_INFINITY,
}: {
  initialRect: CanvasRect;
  resized: { rect: CanvasRect; scaleFactor: number };
  handle: EditorVideoResizeHandle;
  threshold: number;
  minimumScaleFactor?: number;
  maximumScaleFactor?: number;
}): {
  rect: CanvasRect;
  scaleFactor: number;
  snapped: { width: boolean; height: boolean };
} {
  if (
    initialRect.width <= 0
    || initialRect.height <= 0
    || threshold < 0
  ) {
    return {
      ...resized,
      snapped: { width: false, height: false },
    };
  }

  const candidates = [
    {
      axis: "width" as const,
      distance: Math.abs(resized.rect.width - TEMPLATE_CANVAS.width),
      scaleFactor: TEMPLATE_CANVAS.width / initialRect.width,
    },
    {
      axis: "height" as const,
      distance: Math.abs(resized.rect.height - TEMPLATE_CANVAS.height),
      scaleFactor: TEMPLATE_CANVAS.height / initialRect.height,
    },
  ].filter((candidate) => (
    candidate.distance <= threshold
    && candidate.scaleFactor >= minimumScaleFactor
    && candidate.scaleFactor <= maximumScaleFactor
  )).sort((left, right) => left.distance - right.distance);

  const candidate = candidates[0];
  if (!candidate) {
    return {
      ...resized,
      snapped: { width: false, height: false },
    };
  }

  const direction = resizeHandleDirections[handle];
  const anchorX = direction.x > 0
    ? initialRect.x
    : initialRect.x + initialRect.width;
  const anchorY = direction.y > 0
    ? initialRect.y
    : initialRect.y + initialRect.height;
  const width = initialRect.width * candidate.scaleFactor;
  const height = initialRect.height * candidate.scaleFactor;
  const epsilon = 0.001;

  return {
    rect: {
      x: direction.x > 0 ? anchorX : anchorX - width,
      y: direction.y > 0 ? anchorY : anchorY - height,
      width,
      height,
    },
    scaleFactor: candidate.scaleFactor,
    snapped: {
      width: Math.abs(width - TEMPLATE_CANVAS.width) <= epsilon,
      height: Math.abs(height - TEMPLATE_CANVAS.height) <= epsilon,
    },
  };
}

export function canvasOffsetTranslate(offset: CanvasPoint) {
  return `${offset.x / (TEMPLATE_CANVAS.width / 100)}cqw ${offset.y / (TEMPLATE_CANVAS.width / 100)}cqw`;
}

export function lockEditorTitleHorizontalOffset(offset: CanvasPoint): CanvasPoint {
  return { x: 0, y: offset.y };
}
