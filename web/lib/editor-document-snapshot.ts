import type {
  CommentOverlay,
  TemplateId,
  TitleTextStyle,
  VideoAspectRatio,
} from "./contracts";
import {
  cloneEditorOverlayLayout,
  lockEditorTitleHorizontalOffset,
  type EditorOverlayLayoutSnapshot,
} from "./editor-overlay-preview";
import type { EditorVideoClip } from "./editor-video-cuts";

export const EDITOR_DOCUMENT_SNAPSHOT_VERSION = 2 as const;

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

export type EditorDocumentSnapshot = {
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

type EditorDocumentSnapshotInput = Omit<EditorDocumentSnapshot, "version">;

export function createEditorDocumentSnapshot(
  input: EditorDocumentSnapshotInput,
): EditorDocumentSnapshot {
  const overlays = cloneEditorOverlayLayout(input.overlays);
  overlays.offsets.title = lockEditorTitleHorizontalOffset(
    overlays.offsets.title,
  );
  return {
    version: EDITOR_DOCUMENT_SNAPSHOT_VERSION,
    sourceShortId: input.sourceShortId,
    baseRenderVersion: input.baseRenderVersion,
    template: { ...input.template },
    title: {
      ...input.title,
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

export function cloneEditorDocumentSnapshot(
  snapshot: EditorDocumentSnapshot,
): EditorDocumentSnapshot {
  return createEditorDocumentSnapshot(snapshot);
}

export function editorDocumentSnapshotsEqual(
  left: EditorDocumentSnapshot,
  right: EditorDocumentSnapshot,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}
