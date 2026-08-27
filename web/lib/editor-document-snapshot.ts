import type {
  CommentOverlay,
  TemplateId,
  TitleTextStyle,
  VideoAspectRatio,
} from "./contracts";
import {
  cloneEditorOverlayLayout,
  consolidateEditorTitleFontScale,
  lockEditorTitleHorizontalOffset,
  normalizeEditorOverlayLayerOrder,
  type EditorOverlayLayoutSnapshot,
} from "./editor-overlay-preview";
import type { EditorVideoClip } from "./editor-video-cuts";
import {
  createEditorRenderSpec,
  editorSubtitleLayoutFromRenderSpec,
  EDITOR_RENDER_SPEC_V4_VERSION,
  type EditorRenderSpec,
  type EditorSubtitleLayout,
} from "./editor-render-spec";

export const EDITOR_DOCUMENT_SNAPSHOT_VERSION = 2 as const;
export const EDITOR_DOCUMENT_V3_VERSION = 3 as const;

export type EditorDocumentSubtitle = {
  start: number;
  end: number;
  text: string;
};

export type EditorDocumentJsonValue =
  | null
  | string
  | number
  | boolean
  | EditorDocumentJsonValue[]
  | EditorDocumentJsonObject;
export type EditorDocumentJsonObject = {
  [key: string]: EditorDocumentJsonValue;
};

export type EditorDocumentSnapshotV2 = {
  version: typeof EDITOR_DOCUMENT_SNAPSHOT_VERSION;
  sourceShortId: string;
  baseRenderVersion: number;
  template: {
    id: TemplateId;
    customTemplateId: string | null;
    presetVersion: number;
    snapshot: EditorDocumentJsonObject | null;
  };
  title: {
    text: string;
    textStyles: TitleTextStyle[];
    fontScale: number;
  };
  channel: {
    displayName: string;
    thumbnailUrl: string | null;
    thumbnailAssetKey: string | null;
  };
  comments: CommentOverlay[];
  subtitles: {
    enabled: boolean;
    segments: EditorDocumentSubtitle[];
  };
  overlays: EditorOverlayLayoutSnapshot;
  video: {
    clips: EditorVideoClip[];
    aspectRatio: VideoAspectRatio;
    timelineStartSeconds: number;
    timelineEndSeconds: number;
    selectionStartSeconds: number;
    selectionEndSeconds: number;
  };
};

export type EditorDocumentSnapshotV3 = Omit<
  EditorDocumentSnapshotV2,
  "version"
> & {
  version: typeof EDITOR_DOCUMENT_V3_VERSION;
  renderSpec: EditorRenderSpec;
};

export type EditorDocumentSnapshot =
  | EditorDocumentSnapshotV2
  | EditorDocumentSnapshotV3;

type EditorDocumentSnapshotInput = Omit<EditorDocumentSnapshotV2, "version">;

export function createEditorDocumentSnapshot(
  input: EditorDocumentSnapshotInput,
  preserveTitleHorizontalOffset = false,
): EditorDocumentSnapshotV2 {
  const overlays = cloneEditorOverlayLayout(input.overlays);
  const titleFontScale = consolidateEditorTitleFontScale(
    input.title.fontScale,
    overlays.scales.title,
  );
  overlays.scales.title = 1;
  if (!preserveTitleHorizontalOffset) {
    overlays.offsets.title = lockEditorTitleHorizontalOffset(
      overlays.offsets.title,
    );
  }
  return {
    version: EDITOR_DOCUMENT_SNAPSHOT_VERSION,
    sourceShortId: input.sourceShortId,
    baseRenderVersion: input.baseRenderVersion,
    template: { ...input.template },
    title: {
      ...input.title,
      fontScale: titleFontScale,
      textStyles: input.title.textStyles.map((style) => ({ ...style })),
    },
    channel: { ...input.channel },
    comments: input.comments.map((comment) => ({ ...comment })),
    subtitles: {
      enabled: input.subtitles.enabled,
      segments: input.subtitles.segments.map((segment) => ({ ...segment })),
    },
    overlays,
    video: {
      ...input.video,
      clips: input.video.clips.map((clip) => ({ ...clip })),
    },
  };
}

export function createEditorDocumentSnapshotV3(
  input: EditorDocumentSnapshotInput,
  subtitleLayout?: EditorSubtitleLayout,
  pinTitleAboveVideo = false,
  subtitleSpecVersion: 2 | 3 = 3,
  preserveTitleHorizontalOffset = false,
): EditorDocumentSnapshotV3 {
  const v2 = createEditorDocumentSnapshot(
    input,
    preserveTitleHorizontalOffset,
  );
  if (pinTitleAboveVideo) {
    v2.overlays.layerOrder = normalizeEditorOverlayLayerOrder(
      v2.overlays.layerOrder,
    );
  }
  return {
    ...v2,
    version: EDITOR_DOCUMENT_V3_VERSION,
    renderSpec: createEditorRenderSpec(v2, subtitleLayout, subtitleSpecVersion),
  };
}

export function cloneEditorDocumentSnapshot(
  snapshot: EditorDocumentSnapshot,
  preserveTitleHorizontalOffset = false,
): EditorDocumentSnapshot {
  if (
    snapshot.version === EDITOR_DOCUMENT_V3_VERSION
    && snapshot.renderSpec.version === EDITOR_RENDER_SPEC_V4_VERSION
  ) {
    return structuredClone(snapshot);
  }
  return snapshot.version === EDITOR_DOCUMENT_V3_VERSION
    ? createEditorDocumentSnapshotV3(
        snapshot,
        snapshot.renderSpec.version !== 1
          ? editorSubtitleLayoutFromRenderSpec(snapshot.renderSpec)
          : undefined,
        false,
        snapshot.renderSpec.version === 2 ? 2 : 3,
        preserveTitleHorizontalOffset,
      )
    : createEditorDocumentSnapshot(snapshot, preserveTitleHorizontalOffset);
}

export function editorDocumentSnapshotsEqual(
  left: EditorDocumentSnapshot,
  right: EditorDocumentSnapshot,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}
