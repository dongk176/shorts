export type EditorVideoClip = {
  id: string;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
};

export type LocatedEditorVideoTime = {
  clip: EditorVideoClip;
  clipIndex: number;
  clipOutputStartSeconds: number;
  outputSeconds: number;
  sourceSeconds: number;
};

export const EDITOR_VIDEO_MIN_CLIP_SECONDS = 0.15;

const roundSeconds = (value: number) => Math.round(value * 1_000) / 1_000;

export function editorVideoClipDuration(clip: EditorVideoClip) {
  return Math.max(0, clip.sourceEndSeconds - clip.sourceStartSeconds);
}

export function editorVideoDuration(clips: EditorVideoClip[]) {
  return roundSeconds(clips.reduce(
    (duration, clip) => duration + editorVideoClipDuration(clip),
    0,
  ));
}

export function createEditorVideoClips(
  sourceStartSeconds: number,
  sourceEndSeconds: number,
  id = "video-clip-1",
): EditorVideoClip[] {
  return [{
    id,
    sourceStartSeconds: roundSeconds(sourceStartSeconds),
    sourceEndSeconds: roundSeconds(sourceEndSeconds),
  }];
}

export function locateEditorVideoTime(
  clips: EditorVideoClip[],
  requestedOutputSeconds: number,
): LocatedEditorVideoTime | null {
  if (clips.length === 0) return null;
  const totalDuration = editorVideoDuration(clips);
  const outputSeconds = Math.max(0, Math.min(totalDuration, requestedOutputSeconds));
  let clipOutputStartSeconds = 0;

  for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
    const clip = clips[clipIndex];
    const duration = editorVideoClipDuration(clip);
    const clipOutputEndSeconds = clipOutputStartSeconds + duration;
    const isLastClip = clipIndex === clips.length - 1;
    if (outputSeconds < clipOutputEndSeconds - 0.0005 || isLastClip) {
      const clipOffset = Math.max(
        0,
        Math.min(duration, outputSeconds - clipOutputStartSeconds),
      );
      return {
        clip,
        clipIndex,
        clipOutputStartSeconds: roundSeconds(clipOutputStartSeconds),
        outputSeconds: roundSeconds(outputSeconds),
        sourceSeconds: roundSeconds(clip.sourceStartSeconds + clipOffset),
      };
    }
    clipOutputStartSeconds = clipOutputEndSeconds;
  }

  return null;
}

export function editorVideoOutputTimeForSource(
  clips: EditorVideoClip[],
  clipIndex: number,
  sourceSeconds: number,
) {
  const clip = clips[clipIndex];
  if (!clip) return 0;
  const precedingDuration = clips
    .slice(0, clipIndex)
    .reduce((duration, value) => duration + editorVideoClipDuration(value), 0);
  const clipOffset = Math.max(
    0,
    Math.min(editorVideoClipDuration(clip), sourceSeconds - clip.sourceStartSeconds),
  );
  return roundSeconds(precedingDuration + clipOffset);
}

export function canSplitEditorVideoAtTime(
  clips: EditorVideoClip[],
  outputSeconds: number,
  minimumClipSeconds = EDITOR_VIDEO_MIN_CLIP_SECONDS,
) {
  const located = locateEditorVideoTime(clips, outputSeconds);
  if (!located) return false;
  return located.sourceSeconds - located.clip.sourceStartSeconds >= minimumClipSeconds
    && located.clip.sourceEndSeconds - located.sourceSeconds >= minimumClipSeconds;
}

export function splitEditorVideoAtTime(
  clips: EditorVideoClip[],
  outputSeconds: number,
  rightClipId: string,
  minimumClipSeconds = EDITOR_VIDEO_MIN_CLIP_SECONDS,
) {
  const located = locateEditorVideoTime(clips, outputSeconds);
  if (
    !located
    || !canSplitEditorVideoAtTime(clips, outputSeconds, minimumClipSeconds)
  ) {
    return null;
  }

  const leftClip = {
    ...located.clip,
    sourceEndSeconds: located.sourceSeconds,
  };
  const rightClip = {
    id: rightClipId,
    sourceStartSeconds: located.sourceSeconds,
    sourceEndSeconds: located.clip.sourceEndSeconds,
  };
  return {
    clips: [
      ...clips.slice(0, located.clipIndex),
      leftClip,
      rightClip,
      ...clips.slice(located.clipIndex + 1),
    ],
    selectedClipId: leftClip.id,
  };
}

export function deleteEditorVideoClip(
  clips: EditorVideoClip[],
  clipId: string,
  minimumTotalSeconds = 0,
) {
  if (clips.length <= 1) return null;
  const clipIndex = clips.findIndex((clip) => clip.id === clipId);
  if (clipIndex < 0) return null;
  const removedOutputStartSeconds = clips
    .slice(0, clipIndex)
    .reduce((duration, clip) => duration + editorVideoClipDuration(clip), 0);
  const nextClips = clips.filter((clip) => clip.id !== clipId);
  if (editorVideoDuration(nextClips) < minimumTotalSeconds) return null;
  const selectedClip = nextClips[Math.min(clipIndex, nextClips.length - 1)];
  return {
    clips: nextClips,
    removedOutputStartSeconds: roundSeconds(removedOutputStartSeconds),
    selectedClipId: selectedClip?.id || null,
  };
}
