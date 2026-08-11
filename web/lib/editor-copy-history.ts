import type { TitleTextStyle } from "./contracts";
import type { EditorSubtitleLayout } from "./editor-render-spec";

export type EditorSubtitleSegment = {
  start: number;
  end: number;
  text: string;
};

export type EditorCopySnapshot = {
  title: string;
  titleTextStyles: TitleTextStyle[];
  titleFontScale: number;
  channel: string;
  channelThumbnailUrl: string | null;
  channelThumbnailAssetKey: string | null;
  subtitlesEnabled: boolean;
  subtitleSegments: EditorSubtitleSegment[];
  subtitleLayout: EditorSubtitleLayout;
};

export type EditorCopyHistoryEntry = {
  before: EditorCopySnapshot;
  after: EditorCopySnapshot;
};

export type EditorCopyHistory = {
  past: EditorCopyHistoryEntry[];
  future: EditorCopyHistoryEntry[];
};

export const cloneEditorSubtitleSegments = (segments: EditorSubtitleSegment[]) => (
  segments.map((segment) => ({ ...segment }))
);

export const cloneEditorSubtitleLayout = (
  layout: EditorSubtitleLayout,
): EditorSubtitleLayout => ({
  ...layout,
  ...(layout.cueEdits
    ? { cueEdits: layout.cueEdits.map((edit) => ({ ...edit })) }
    : {}),
});

export const cloneEditorCopySnapshot = (
  snapshot: EditorCopySnapshot,
): EditorCopySnapshot => ({
  title: snapshot.title,
  titleTextStyles: snapshot.titleTextStyles.map((style) => ({ ...style })),
  titleFontScale: snapshot.titleFontScale,
  channel: snapshot.channel,
  channelThumbnailUrl: snapshot.channelThumbnailUrl,
  channelThumbnailAssetKey: snapshot.channelThumbnailAssetKey,
  subtitlesEnabled: snapshot.subtitlesEnabled,
  subtitleSegments: cloneEditorSubtitleSegments(snapshot.subtitleSegments),
  subtitleLayout: cloneEditorSubtitleLayout(snapshot.subtitleLayout),
});

export const cloneEditorCopyHistoryEntry = (
  entry: EditorCopyHistoryEntry,
): EditorCopyHistoryEntry => ({
  before: cloneEditorCopySnapshot(entry.before),
  after: cloneEditorCopySnapshot(entry.after),
});

export const editorCopySnapshotsEqual = (
  left: EditorCopySnapshot,
  right: EditorCopySnapshot,
) => (
  left.title === right.title
  && left.titleFontScale === right.titleFontScale
  && left.channel === right.channel
  && left.channelThumbnailUrl === right.channelThumbnailUrl
  && left.channelThumbnailAssetKey === right.channelThumbnailAssetKey
  && left.subtitlesEnabled === right.subtitlesEnabled
  && JSON.stringify(left.subtitleSegments) === JSON.stringify(right.subtitleSegments)
  && JSON.stringify(left.subtitleLayout) === JSON.stringify(right.subtitleLayout)
  && JSON.stringify(left.titleTextStyles) === JSON.stringify(right.titleTextStyles)
);

export const editorCopyTitleChanged = (entry: EditorCopyHistoryEntry) => (
  entry.before.title !== entry.after.title
  || entry.before.titleFontScale !== entry.after.titleFontScale
  || JSON.stringify(entry.before.titleTextStyles)
    !== JSON.stringify(entry.after.titleTextStyles)
);

export const editorCopySubtitleChanged = (entry: EditorCopyHistoryEntry) => (
  entry.before.subtitlesEnabled !== entry.after.subtitlesEnabled
  || JSON.stringify(entry.before.subtitleSegments)
    !== JSON.stringify(entry.after.subtitleSegments)
  || JSON.stringify(entry.before.subtitleLayout)
    !== JSON.stringify(entry.after.subtitleLayout)
);

export function recordEditorCopyHistory(
  history: EditorCopyHistory,
  before: EditorCopySnapshot,
  after: EditorCopySnapshot,
  limit = 100,
) {
  if (editorCopySnapshotsEqual(before, after)) return history;
  return {
    past: [
      ...history.past,
      cloneEditorCopyHistoryEntry({ before, after }),
    ].slice(-limit),
    future: [],
  };
}

export function undoEditorCopyHistory(
  history: EditorCopyHistory,
): { history: EditorCopyHistory; snapshot: EditorCopySnapshot | null } {
  const entry = history.past.at(-1);
  if (!entry) return { history, snapshot: null };
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [
        cloneEditorCopyHistoryEntry(entry),
        ...history.future.map(cloneEditorCopyHistoryEntry),
      ],
    },
    snapshot: cloneEditorCopySnapshot(entry.before),
  };
}

export function redoEditorCopyHistory(
  history: EditorCopyHistory,
): { history: EditorCopyHistory; snapshot: EditorCopySnapshot | null } {
  const [entry, ...future] = history.future;
  if (!entry) return { history, snapshot: null };
  return {
    history: {
      past: [
        ...history.past.map(cloneEditorCopyHistoryEntry),
        cloneEditorCopyHistoryEntry(entry),
      ],
      future: future.map(cloneEditorCopyHistoryEntry),
    },
    snapshot: cloneEditorCopySnapshot(entry.after),
  };
}
