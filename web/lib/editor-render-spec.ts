import {
  fitPreviewTitleFont,
  styledTitleLineRuns,
  TITLE_LINE_GAP,
  titleLineCharacterIndices,
  titlePreviewLinePaddingX,
  titlePreviewLinePaddingY,
  wrapPreviewTitle,
} from "@/lib/title-preview";
import {
  editorFontIds,
  editorTitleBaselineOffsetEmById,
  editorWordSpaceAdvanceEmById,
  ensureEditorFontFaceV4Loaded,
  resolveEditorFontFace,
  resolveEditorFontFaceV4,
  type EditorFontId,
  type ResolvedEditorFontFace,
  type ResolvedEditorFontFaceV4,
} from "@/lib/editor-fonts";
import { isEditorRenderSpecV4Enabled } from "@/lib/editor-render-v4-feature";
import type { EditorDocumentSnapshotV2 } from "@/lib/editor-document-snapshot";
import {
  COMMENT_CAPTURE_LANDSCAPE_LIFT_PX,
  type TemplatePresetColor,
} from "@/lib/template-config";

export const EDITOR_RENDER_SPEC_LEGACY_VERSION = 1 as const;
export const EDITOR_RENDER_SPEC_SUBTITLE_LEGACY_VERSION = 2 as const;
export const EDITOR_RENDER_SPEC_VERSION = 3 as const;
export const EDITOR_RENDER_SPEC_V4_VERSION = 4 as const;
export const EDITOR_RENDER_FIXED_POINT_SCALE = 1_000 as const;
export const EDITOR_RENDER_FIXED_POINT_PRECISION_PX = 0.001 as const;
export const EDITOR_RENDER_CANVAS = { width: 1080, height: 1920 } as const;
export const EDITOR_RENDER_FPS = 30 as const;
export const EDITOR_SUBTITLE_DEFAULT_MARGIN_V = 445 as const;
export const EDITOR_SUBTITLE_DEFAULT_FONT_SIZE = 48 as const;
export const EDITOR_SUBTITLE_OFFSET_Y_MIN = -900 as const;
export const EDITOR_SUBTITLE_OFFSET_Y_MAX = 900 as const;
export const EDITOR_SUBTITLE_SCALE_MIN = 0.5 as const;
export const EDITOR_SUBTITLE_SCALE_MAX = 2 as const;

export type EditorSubtitleCueEdit = {
  cueIndex: number;
  text: string;
};

export type EditorSubtitleLayout = {
  offsetY: number;
  scale: number;
  fontId?: EditorFontId;
  fontSize?: number;
  color?: string;
  accentColor?: string;
  cueEdits?: EditorSubtitleCueEdit[];
};

export const DEFAULT_EDITOR_SUBTITLE_LAYOUT: Readonly<EditorSubtitleLayout> = {
  offsetY: 0,
  scale: 1,
};

export type EditorRenderTextLayerSpec = {
  id: string;
  lines: string[];
  centerX: number;
  centerY: number;
  width: number;
  fontSize: 72;
  lineHeight: 86;
  scale: number;
  color: TemplatePresetColor;
  effect: "none" | "outline" | "shadow";
  outlineWidth: 0 | 10;
  shadowBlur: 0 | 13;
  startFrame: number;
  endFrame: number;
  font: ResolvedEditorFontFace;
};

type EditorRenderSpecBase = {
  canvas: typeof EDITOR_RENDER_CANVAS;
  fps: typeof EDITOR_RENDER_FPS;
  layerOrder: string[];
  title: {
    lines: string[];
    centerX: 540;
    offsetY: number;
    fontSize: number;
    scale: 1;
    font: ResolvedEditorFontFace;
  };
  channel: {
    offsetX: number;
    offsetY: number;
    scale: number;
    font: ResolvedEditorFontFace;
  };
  comments: Array<{
    id: string;
    offsetY: number;
    startFrame: number;
    endFrame: number;
  }>;
  textOverlays: EditorRenderTextLayerSpec[];
  video: {
    offsetX: number;
    offsetY: number;
    scale: number;
  };
};

export type EditorRenderSpecV1 = EditorRenderSpecBase & {
  version: typeof EDITOR_RENDER_SPEC_LEGACY_VERSION;
};

export type EditorRenderSpecV2 = EditorRenderSpecBase & {
  version: typeof EDITOR_RENDER_SPEC_SUBTITLE_LEGACY_VERSION;
  subtitles: {
    centerX: 540;
    offsetY: number;
    scale: number;
    fontId?: EditorFontId;
    accentColor?: string;
    cueEdits?: EditorSubtitleCueEdit[];
  };
};

export type EditorRenderSpecV3 = EditorRenderSpecBase & {
  version: typeof EDITOR_RENDER_SPEC_VERSION;
  subtitles: EditorRenderSpecV2["subtitles"] & {
    fontSize: number;
    color: string;
  };
};

export type EditorRenderTitleBackgroundRunV4 = {
  start: number;
  end: number;
  color: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  radius?: number;
};

export type EditorRenderTitleLineBoxV4 = {
  text: string;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  baselineY: number;
  backgroundRuns: EditorRenderTitleBackgroundRunV4[];
};

export type EditorRenderTitleSpecV4 = {
  visible: boolean;
  lines: string[];
  centerX: number;
  centerY: number;
  offsetY: number;
  fontSize: number;
  scale: 1;
  lineGap: number;
  linePaddingX: number;
  linePaddingY: number;
  clamp: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  lineBoxes: EditorRenderTitleLineBoxV4[];
  font: ResolvedEditorFontFaceV4;
};

export type EditorRenderSpecV4 = Omit<
  EditorRenderSpecBase,
  "title" | "channel" | "textOverlays"
> & {
  version: typeof EDITOR_RENDER_SPEC_V4_VERSION;
  title: EditorRenderTitleSpecV4;
  channel: Omit<EditorRenderSpecBase["channel"], "font"> & {
    visible: boolean;
    font: ResolvedEditorFontFaceV4;
  };
  textOverlays: Array<Omit<EditorRenderTextLayerSpec, "font"> & {
    font: ResolvedEditorFontFaceV4;
  }>;
  subtitles?: EditorRenderSpecV3["subtitles"] & {
    visible: true;
    captionSpecVersion: 4;
  };
};

export type EditorRenderSpec =
  | EditorRenderSpecV1
  | EditorRenderSpecV2
  | EditorRenderSpecV3
  | EditorRenderSpecV4;

export type EditorRenderSpecVersion = EditorRenderSpec["version"];

export type EditorRenderDocumentInput = Omit<
  EditorDocumentSnapshotV2,
  "version" | "overlays"
> & {
  overlays: Omit<EditorDocumentSnapshotV2["overlays"], "layerOrder"> & {
    layerOrder: string[];
  };
  renderSpec?: EditorRenderSpec;
};

export function editorRenderSpecSupportsAbsoluteSubtitleStyle(
  version: EditorRenderSpecVersion,
) {
  return version === EDITOR_RENDER_SPEC_VERSION
    || version === EDITOR_RENDER_SPEC_V4_VERSION;
}

export function editorRenderSpecSupportsPositionedWords(
  version: EditorRenderSpecVersion,
) {
  return version === EDITOR_RENDER_SPEC_V4_VERSION;
}

export function quantizeEditorRenderPx(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error("Editor render coordinates must be finite.");
  }
  return Math.round(value * EDITOR_RENDER_FIXED_POINT_SCALE)
    / EDITOR_RENDER_FIXED_POINT_SCALE;
}

export function isQuantizedEditorRenderPx(value: number) {
  return Number.isFinite(value)
    && !Object.is(value, -0)
    && value === quantizeEditorRenderPx(value);
}

export function normalizeEditorSubtitleLayout(
  value: EditorSubtitleLayout,
): EditorSubtitleLayout {
  const cueEdits = [...(value.cueEdits || [])]
    .filter((edit) => (
      Number.isInteger(edit.cueIndex)
      && edit.cueIndex >= 0
      && edit.cueIndex < 2_000
      && edit.text.trim().length > 0
      && edit.text.trim().length <= 200
    ))
    .sort((left, right) => left.cueIndex - right.cueIndex)
    .filter((edit, index, values) => (
      index === values.length - 1
      || values[index + 1].cueIndex !== edit.cueIndex
    ))
    .map((edit) => ({
      cueIndex: edit.cueIndex,
      text: edit.text.trim(),
    }));
  const accentColor = /^#[0-9A-Fa-f]{6}$/.test(value.accentColor || "")
    ? value.accentColor
    : undefined;
  const color = /^#[0-9A-Fa-f]{6}$/.test(value.color || "")
    ? value.color
    : undefined;
  const fontId = editorFontIds.includes(value.fontId as EditorFontId)
    ? value.fontId
    : undefined;
  return {
    offsetY: Math.max(
      EDITOR_SUBTITLE_OFFSET_Y_MIN,
      Math.min(EDITOR_SUBTITLE_OFFSET_Y_MAX, Math.round(value.offsetY)),
    ),
    ...(fontId ? { fontId } : {}),
    ...(typeof value.fontSize === "number" && Number.isFinite(value.fontSize)
      ? { fontSize: Math.max(24, Math.min(120, Math.round(value.fontSize))) }
      : {}),
    scale: Math.max(
      EDITOR_SUBTITLE_SCALE_MIN,
      Math.min(
        EDITOR_SUBTITLE_SCALE_MAX,
        Math.round(value.scale * 100) / 100,
      ),
    ),
    ...(accentColor ? { accentColor } : {}),
    ...(color ? { color } : {}),
    ...(cueEdits.length > 0 ? { cueEdits } : {}),
  };
}

export function editorSubtitleLayoutFromRenderSpec(
  renderSpec: EditorRenderSpec | null | undefined,
): EditorSubtitleLayout {
  return (
    renderSpec?.version === EDITOR_RENDER_SPEC_VERSION
    || renderSpec?.version === EDITOR_RENDER_SPEC_SUBTITLE_LEGACY_VERSION
    || (
      renderSpec?.version === EDITOR_RENDER_SPEC_V4_VERSION
      && renderSpec.subtitles
    )
  )
    ? normalizeEditorSubtitleLayout(renderSpec.subtitles!)
    : { ...DEFAULT_EDITOR_SUBTITLE_LAYOUT };
}

function frameAt(seconds: number) {
  return Math.max(0, Math.round(seconds * EDITOR_RENDER_FPS));
}

function estimatedCharacterWidth(character: string, fontSize: number) {
  if (/\s/u.test(character)) return fontSize * 0.28;
  if (/\p{Script=Hangul}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) {
    return fontSize;
  }
  if (/\p{Extended_Pictographic}/u.test(character)) return fontSize;
  if (/[A-Z]/.test(character)) return fontSize * 0.68;
  if (/[a-z]/.test(character)) return fontSize * 0.56;
  if (/[0-9]/.test(character)) return fontSize * 0.62;
  return fontSize * 0.45;
}

export function wrapEditorRenderText(
  value: string,
  width: number,
  fontSize = 72,
) {
  const maximumWidth = Math.max(1, width - 44);
  const lines: string[] = [];
  for (const paragraph of (value || "텍스트").split("\n")) {
    let current = "";
    let currentWidth = 0;
    for (const character of Array.from(paragraph)) {
      const characterWidth = estimatedCharacterWidth(character, fontSize);
      if (current && currentWidth + characterWidth > maximumWidth) {
        lines.push(current.trimEnd());
        current = character.trimStart();
        currentWidth = current
          ? estimatedCharacterWidth(current, fontSize)
          : 0;
      } else {
        current += character;
        currentWidth += characterWidth;
      }
    }
    lines.push(current || " ");
  }
  return lines.slice(0, 20);
}

type SnapshotTitleConfig = {
  visible?: boolean;
  x?: number;
  y?: number;
  maxWidth?: number;
  fontSize?: number;
  primaryBackgroundColor?: string | null;
  accentBackgroundColor?: string | null;
};

function titleSnapshotConfig(
  document: Pick<EditorDocumentSnapshotV2, "template">,
): SnapshotTitleConfig | null {
  const config = document.template.snapshot?.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const title = config.title;
  return title && typeof title === "object" && !Array.isArray(title)
    ? title as SnapshotTitleConfig
    : null;
}

function titlePanelBounds(
  document: Pick<EditorDocumentSnapshotV2, "template" | "video">,
) {
  if (
    document.template.id === "comment-capture"
    && document.video.aspectRatio === "9:16"
  ) {
    // The comment template reserves the same title panel as its 4:5 layout
    // even when the source fills a 9:16 canvas. Keep this in lockstep with
    // worker/shorts_worker/render_spec_v4.py.
    return { y: 0, height: 285 };
  }
  if (document.video.aspectRatio === "9:16") {
    return { y: 96, height: 360 };
  }
  const videoHeights = {
    "16:9": 608,
    "5:4": 864,
    "1:1": 1080,
    "4:5": 1350,
  } as const;
  const lift = document.template.id === "comment-capture"
    && document.video.aspectRatio === "16:9"
    ? COMMENT_CAPTURE_LANDSCAPE_LIFT_PX
    : 0;
  return {
    y: 0,
    height: (EDITOR_RENDER_CANVAS.height - videoHeights[document.video.aspectRatio]) / 2 - lift,
  };
}

export type EditorTitleTextMeasurementV4 = {
  width: number;
  actualBoundingBoxAscent: number;
  actualBoundingBoxDescent: number;
};

export type EditorTitleTextMeasurerV4 = (
  text: string,
  fontSize: number,
  font: ResolvedEditorFontFaceV4,
) => EditorTitleTextMeasurementV4;

function lineBackgroundRuns(
  line: string,
  lineIndex: number,
  document: Pick<EditorDocumentSnapshotV2, "title">,
  snapshotTitle: SnapshotTitleConfig | null,
) {
  const indices = titleLineCharacterIndices(
    document.title.text,
    wrapPreviewTitle(document.title.text),
  )[lineIndex] || Array.from(line).map(() => null);
  const defaultBackground = lineIndex === 1
    ? snapshotTitle?.accentBackgroundColor
    : snapshotTitle?.primaryBackgroundColor;
  const runs = styledTitleLineRuns(
    line,
    indices,
    document.title.textStyles,
  );
  const result: EditorRenderTitleBackgroundRunV4[] = [];
  let offset = 0;
  for (const run of runs) {
    const length = Array.from(run.text).length;
    const color = run.backgroundColor || defaultBackground;
    if (color) {
      const previous = result.at(-1);
      if (previous && previous.end === offset && previous.color === color) {
        previous.end += length;
      } else {
        result.push({ start: offset, end: offset + length, color });
      }
    }
    offset += length;
  }
  return result;
}

export function compileEditorRenderTitleSpecV4(
  document: EditorRenderDocumentInput,
  measure: EditorTitleTextMeasurerV4,
): EditorRenderTitleSpecV4 {
  const lines = wrapPreviewTitle(document.title.text);
  const snapshotTitle = titleSnapshotConfig(document);
  const font = resolveEditorFontFaceV4(document.overlays.fonts.title, "title");
  const exactMeasure = (text: string, size: number) => {
    const measured = measure(text, size, font);
    const segments = text.split(" ");
    if (segments.length === 1) return measured;
    const segmentWidth = segments.reduce((total, segment) => (
      total + (segment ? measure(segment, size, font).width : 0)
    ), 0);
    return {
      ...measured,
      width: segmentWidth
        + (segments.length - 1)
          * size
          * editorWordSpaceAdvanceEmById[font.fontId],
    };
  };
  const configuredFontSize = Math.max(
    18,
    Math.min(200, Math.round(
      (typeof snapshotTitle?.fontSize === "number"
        ? snapshotTitle.fontSize
        : 84) * document.title.fontScale,
    )),
  );
  const customLayout = typeof snapshotTitle?.y === "number";
  const maxWidth = Math.max(
    1,
    Math.min(
      EDITOR_RENDER_CANVAS.width,
      typeof snapshotTitle?.maxWidth === "number"
        ? snapshotTitle.maxWidth
        : 930,
    ),
  );
  let fontSize = configuredFontSize;
  let linePaddingX = 0;
  let linePaddingY = 0;
  let measurements: EditorTitleTextMeasurementV4[] = [];
  for (let candidate = configuredFontSize; candidate >= 18; candidate -= 1) {
    const candidatePaddingX = customLayout
      ? Math.max(10, Math.round(candidate * 0.28))
      : titlePreviewLinePaddingX(candidate);
    const candidatePaddingY = customLayout
      ? Math.max(6, Math.round(candidate * 0.14))
      : titlePreviewLinePaddingY(candidate);
    const candidateMeasurements = lines.map((line) => exactMeasure(line, candidate));
    if (candidateMeasurements.some((item) => (
      !Number.isFinite(item.width)
      || item.width < 0
    ))) {
      throw new Error("Exact title font metrics are unavailable.");
    }
    fontSize = candidate;
    linePaddingX = candidatePaddingX;
    linePaddingY = candidatePaddingY;
    measurements = candidateMeasurements;
    if (candidateMeasurements.every(
      (item) => item.width + candidatePaddingX * 2 <= maxWidth,
    )) break;
  }
  fontSize = quantizeEditorRenderPx(fontSize);
  linePaddingX = quantizeEditorRenderPx(linePaddingX);
  linePaddingY = quantizeEditorRenderPx(linePaddingY);
  const lineGap = quantizeEditorRenderPx(customLayout
    ? Math.max(6, Math.round(fontSize * 0.18))
    : TITLE_LINE_GAP);
  const backgroundRuns = lines.map((line, lineIndex) => (
    lineBackgroundRuns(line, lineIndex, document, snapshotTitle)
  ));
  const widths = measurements.map((measurement) => quantizeEditorRenderPx(
    measurement.width + linePaddingX * 2,
  ));
  // Canvas glyph ink bounds vary by Chromium/OS even when the exact same
  // immutable font bytes are loaded. Title layout uses the configured em box
  // instead, matching the stored background box and the Linux renderer.
  const heights = lines.map(() => quantizeEditorRenderPx(
    fontSize + linePaddingY * 2,
  ));
  const contentHeight = quantizeEditorRenderPx(
    heights.reduce((total, height) => total + height, 0)
      + lineGap * Math.max(0, lines.length - 1),
  );
  const panel = titlePanelBounds(document);
  const bottomMargin = panel.height === 285
    ? 12
    : Math.min(44, Math.max(24, Math.round(panel.height * 0.105)));
  const requestedCenterX = quantizeEditorRenderPx(
    (typeof snapshotTitle?.x === "number" ? snapshotTitle.x : 540)
      + document.overlays.offsets.title.x,
  );
  const requestedCenterY = quantizeEditorRenderPx(
    (typeof snapshotTitle?.y === "number"
      ? snapshotTitle.y
      : panel.y + panel.height - bottomMargin - contentHeight / 2)
      + document.overlays.offsets.title.y,
  );
  const maximumLineWidth = Math.max(...widths);
  const clamp = {
    minX: 0,
    maxX: EDITOR_RENDER_CANVAS.width,
    minY: 0,
    maxY: EDITOR_RENDER_CANVAS.height,
  };
  const centerX = quantizeEditorRenderPx(Math.max(
    clamp.minX + maximumLineWidth / 2,
    Math.min(clamp.maxX - maximumLineWidth / 2, requestedCenterX),
  ));
  const centerY = quantizeEditorRenderPx(Math.max(
    clamp.minY + contentHeight / 2,
    Math.min(clamp.maxY - contentHeight / 2, requestedCenterY),
  ));
  let nextTop = centerY - contentHeight / 2;
  const lineBoxes = lines.map((text, index) => {
    const lineCenterY = quantizeEditorRenderPx(nextTop + heights[index] / 2);
    // Backgrounds use the configured em box instead of browser-specific glyph
    // ink bounds. Canvas and Pillow disagree by a few pixels for the same
    // bundled font, while the em box is part of the render contract and stays
    // stable for every title string in both runtimes.
    const backgroundHeight = quantizeEditorRenderPx(
      fontSize + linePaddingY * 2,
    );
    nextTop += heights[index] + lineGap;
    const characters = Array.from(text);
    const lineLeft = centerX - (widths[index] - linePaddingX * 2) / 2;
    const finalBackgroundRuns = backgroundRuns[index].map((run) => {
      const runLeft = lineLeft + exactMeasure(
        characters.slice(0, run.start).join(""),
        fontSize,
      ).width;
      const runRight = lineLeft + exactMeasure(
        characters.slice(0, run.end).join(""),
        fontSize,
      ).width;
      return {
        ...run,
        x: quantizeEditorRenderPx(runLeft - linePaddingX),
        y: quantizeEditorRenderPx(lineCenterY - backgroundHeight / 2),
        width: quantizeEditorRenderPx(
          runRight - runLeft + linePaddingX * 2,
        ),
        height: backgroundHeight,
        radius: quantizeEditorRenderPx(Math.max(6, Math.round(fontSize * 0.14))),
      };
    });
    return {
      text,
      centerX,
      centerY: lineCenterY,
      width: widths[index],
      height: heights[index],
      baselineY: quantizeEditorRenderPx(
        lineCenterY + fontSize * editorTitleBaselineOffsetEmById[font.fontId],
      ),
      backgroundRuns: finalBackgroundRuns,
    };
  });
  return {
    visible: snapshotTitle?.visible !== false && document.overlays.visible.title,
    lines,
    centerX,
    centerY,
    offsetY: quantizeEditorRenderPx(document.overlays.offsets.title.y),
    fontSize,
    scale: 1,
    lineGap,
    linePaddingX,
    linePaddingY,
    clamp,
    lineBoxes,
    font,
  };
}

export async function createEditorRenderTitleSpecV4(
  document: EditorRenderDocumentInput,
) {
  if (!isEditorRenderSpecV4Enabled()) {
    throw new Error("Editor render specification v4 is disabled.");
  }
  const font = resolveEditorFontFaceV4(document.overlays.fonts.title, "title");
  await ensureEditorFontFaceV4Loaded(font, document.title.text);
  const context = documentGlobalCanvasContext();
  return compileEditorRenderTitleSpecV4(document, (text, fontSize, exactFont) => {
    context.font = `${exactFont.resolvedWeight} ${fontSize}px ${exactFont.family}`;
    const measured = context.measureText(text);
    return {
      width: measured.width,
      actualBoundingBoxAscent: measured.actualBoundingBoxAscent,
      actualBoundingBoxDescent: measured.actualBoundingBoxDescent,
    };
  });
}

function documentGlobalCanvasContext() {
  if (typeof document === "undefined") {
    throw new Error("Exact editor title measurement requires a browser.");
  }
  const context = document.createElement("canvas").getContext("2d");
  if (!context) {
    throw new Error("Exact editor title measurement is unavailable.");
  }
  return context;
}

export function createEditorRenderSpec(
  document: EditorRenderDocumentInput,
  requestedSubtitleLayout?: EditorSubtitleLayout,
  requestedRenderSpecVersion?: EditorRenderSpecVersion,
): EditorRenderSpec {
  const effectiveRenderSpecVersion = requestedRenderSpecVersion
    ?? (requestedSubtitleLayout
      ? document.renderSpec?.version === EDITOR_RENDER_SPEC_SUBTITLE_LEGACY_VERSION
        || document.renderSpec?.version === EDITOR_RENDER_SPEC_VERSION
        || document.renderSpec?.version === EDITOR_RENDER_SPEC_V4_VERSION
        ? document.renderSpec.version
        : EDITOR_RENDER_SPEC_VERSION
      : document.renderSpec?.version ?? EDITOR_RENDER_SPEC_VERSION);
  const titleLines = wrapPreviewTitle(document.title.text);
  const snapshotConfig = document.template.snapshot?.config;
  const snapshotTitle = snapshotConfig
    && typeof snapshotConfig === "object"
    && !Array.isArray(snapshotConfig)
    && snapshotConfig.title
    && typeof snapshotConfig.title === "object"
    && !Array.isArray(snapshotConfig.title)
    ? snapshotConfig.title
    : null;
  const customTitleFontSize = snapshotTitle
    && typeof snapshotTitle.fontSize === "number"
    ? snapshotTitle.fontSize
    : null;
  const titleFontSize = Math.max(
    18,
    Math.min(
      200,
      Math.round(
        (customTitleFontSize || fitPreviewTitleFont(titleLines))
        * document.title.fontScale,
      ),
    ),
  );
  const subtitleLayout = requestedSubtitleLayout
    || (document.renderSpec?.version === EDITOR_RENDER_SPEC_VERSION
      || document.renderSpec?.version === EDITOR_RENDER_SPEC_SUBTITLE_LEGACY_VERSION
      || (
        document.renderSpec?.version === EDITOR_RENDER_SPEC_V4_VERSION
        && document.renderSpec.subtitles
      )
      ? document.renderSpec.subtitles!
      : null);
  const preserveLegacySubtitleSpec = effectiveRenderSpecVersion
    === EDITOR_RENDER_SPEC_SUBTITLE_LEGACY_VERSION;
  const base: EditorRenderSpecBase = {
    canvas: EDITOR_RENDER_CANVAS,
    fps: EDITOR_RENDER_FPS,
    layerOrder: [...document.overlays.layerOrder],
    title: {
      lines: titleLines,
      centerX: 540,
      offsetY: document.overlays.offsets.title.y,
      fontSize: titleFontSize,
      scale: 1 as const,
      font: resolveEditorFontFace(document.overlays.fonts.title, "title"),
    },
    channel: {
      offsetX: document.overlays.offsets.channel.x,
      offsetY: document.overlays.offsets.channel.y,
      scale: document.overlays.scales.channel,
      font: resolveEditorFontFace(document.overlays.fonts.channel, "channel"),
    },
    comments: document.comments.map((comment) => ({
      id: comment.id,
      offsetY: (
        document.overlays.commentOffsets[comment.id]
        || document.overlays.offsets.comment
      ).y,
      startFrame: frameAt(comment.startSeconds),
      endFrame: frameAt(comment.endSeconds),
    })),
    textOverlays: document.overlays.textOverlays.map((overlay) => ({
      id: overlay.id,
      lines: wrapEditorRenderText(overlay.text, overlay.width),
      centerX: 540 + overlay.offset.x,
      centerY: 960 + overlay.offset.y,
      width: overlay.width,
      fontSize: 72,
      lineHeight: 86,
      scale: overlay.scale,
      color: overlay.color,
      effect: overlay.effect,
      outlineWidth: overlay.effect === "outline" ? 10 : 0,
      shadowBlur: overlay.effect === "shadow" ? 13 : 0,
      startFrame: frameAt(overlay.startSeconds),
      endFrame: frameAt(overlay.endSeconds),
      font: resolveEditorFontFace(overlay.fontId, "text"),
    })),
    video: {
      offsetX: document.overlays.offsets.video.x,
      offsetY: document.overlays.offsets.video.y,
      scale: document.overlays.scales.video,
    },
  };
  if (effectiveRenderSpecVersion === EDITOR_RENDER_SPEC_V4_VERSION) {
    throw new Error(
      "Render specification v4 requires exact asynchronous font measurement.",
    );
  }
  if (!subtitleLayout) {
    return {
      ...base,
      version: EDITOR_RENDER_SPEC_LEGACY_VERSION,
    };
  }
  const normalizedSubtitleLayout = normalizeEditorSubtitleLayout(
    subtitleLayout,
  );
  if (preserveLegacySubtitleSpec) {
    return {
      ...base,
      version: EDITOR_RENDER_SPEC_SUBTITLE_LEGACY_VERSION,
      subtitles: {
        centerX: 540,
        offsetY: normalizedSubtitleLayout.offsetY,
        scale: normalizedSubtitleLayout.scale,
        ...(normalizedSubtitleLayout.fontId
          ? { fontId: normalizedSubtitleLayout.fontId }
          : {}),
        ...(normalizedSubtitleLayout.accentColor
          ? { accentColor: normalizedSubtitleLayout.accentColor }
          : {}),
        ...(normalizedSubtitleLayout.cueEdits
          ? { cueEdits: normalizedSubtitleLayout.cueEdits }
          : {}),
      },
    };
  }
  return {
    ...base,
    version: EDITOR_RENDER_SPEC_VERSION,
    subtitles: {
      centerX: 540,
      ...normalizedSubtitleLayout,
      fontSize: normalizedSubtitleLayout.fontSize
        ?? EDITOR_SUBTITLE_DEFAULT_FONT_SIZE,
      color: normalizedSubtitleLayout.color ?? "#FFFFFF",
    },
  };
}

export async function createEditorRenderSpecV4(
  document: EditorRenderDocumentInput,
  requestedSubtitleLayout?: EditorSubtitleLayout,
): Promise<EditorRenderSpecV4> {
  if (!isEditorRenderSpecV4Enabled()) {
    throw new Error("Editor render specification v4 is disabled.");
  }
  const legacySpec = createEditorRenderSpec(
    document,
    document.subtitles.enabled
      ? requestedSubtitleLayout || DEFAULT_EDITOR_SUBTITLE_LAYOUT
      : undefined,
    document.subtitles.enabled
      ? EDITOR_RENDER_SPEC_VERSION
      : EDITOR_RENDER_SPEC_LEGACY_VERSION,
  );
  const title = await createEditorRenderTitleSpecV4(document);
  const channelFont = resolveEditorFontFaceV4(
    document.overlays.fonts.channel,
    "channel",
  );
  const textOverlayFonts = document.overlays.textOverlays.map((overlay) => (
    resolveEditorFontFaceV4(overlay.fontId, "text")
  ));
  await Promise.all([
    ensureEditorFontFaceV4Loaded(channelFont, document.channel.displayName),
    ...textOverlayFonts.map((font, index) => (
      ensureEditorFontFaceV4Loaded(
        font,
        document.overlays.textOverlays[index].text || "텍스트",
      )
    )),
  ]);
  const normalizedSubtitleLayout = normalizeEditorSubtitleLayout(
    requestedSubtitleLayout || DEFAULT_EDITOR_SUBTITLE_LAYOUT,
  );
  return {
    canvas: legacySpec.canvas,
    fps: legacySpec.fps,
    layerOrder: legacySpec.layerOrder,
    comments: legacySpec.comments,
    video: legacySpec.video,
    version: EDITOR_RENDER_SPEC_V4_VERSION,
    title,
    channel: {
      ...legacySpec.channel,
      visible: document.overlays.visible.channel,
      font: channelFont,
    },
    textOverlays: legacySpec.textOverlays.map((overlay, index) => ({
      ...overlay,
      font: textOverlayFonts[index],
    })),
    ...(document.subtitles.enabled
      ? {
          subtitles: {
            centerX: 540 as const,
            ...normalizedSubtitleLayout,
            fontSize: normalizedSubtitleLayout.fontSize
              ?? EDITOR_SUBTITLE_DEFAULT_FONT_SIZE,
            color: normalizedSubtitleLayout.color ?? "#FFFFFF",
            visible: true as const,
            captionSpecVersion: 4 as const,
          },
        }
      : {}),
  };
}
