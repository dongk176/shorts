import type { CaptionRenderSpec } from "./caption-render-spec";
import type { EditorVideoClip } from "./editor-video-cuts";
import {
  EDITOR_RENDER_CANVAS,
  EDITOR_SUBTITLE_OFFSET_Y_MAX,
  EDITOR_SUBTITLE_OFFSET_Y_MIN,
} from "./editor-render-spec";

const frameAt = (seconds: number, fps: number) => (
  Math.floor(seconds * fps + 0.5)
);

export function editorCaptionVerticalOffsetBounds(
  spec: CaptionRenderSpec,
  scale: number,
) {
  const centerY = spec.safeArea.y + spec.safeArea.height / 2;
  const halfHeight = (
    spec.safeArea.height / 2 + spec.style.outlineWidth
  ) * scale;
  return {
    min: Math.max(
      EDITOR_SUBTITLE_OFFSET_Y_MIN,
      Math.ceil(halfHeight - centerY),
    ),
    max: Math.min(
      EDITOR_SUBTITLE_OFFSET_Y_MAX,
      Math.floor(EDITOR_RENDER_CANVAS.height - centerY - halfHeight),
    ),
  };
}

export function retimeCaptionRenderSpecForEditor(
  spec: CaptionRenderSpec,
  clips: EditorVideoClip[],
): CaptionRenderSpec | null {
  let outputCursor = 0;
  const unmergedWindows = clips.flatMap((clip) => {
    const startFrame = frameAt(clip.sourceStartSeconds, spec.fps);
    const endFrame = frameAt(clip.sourceEndSeconds, spec.fps);
    if (endFrame <= startFrame) return [];
    const window = {
      startFrame,
      endFrame,
      outputStartFrame: outputCursor,
    };
    outputCursor += endFrame - startFrame;
    return [window];
  });
  const clipWindows = unmergedWindows.reduce<typeof unmergedWindows>(
    (windows, window) => {
      const previous = windows.at(-1);
      if (
        previous
        && previous.endFrame === window.startFrame
        && previous.outputStartFrame
          + previous.endFrame
          - previous.startFrame === window.outputStartFrame
      ) {
        previous.endFrame = window.endFrame;
      } else {
        windows.push({ ...window });
      }
      return windows;
    },
    [],
  );

  const cues = spec.cues.flatMap((cue, cueIndex) => (
    clipWindows.flatMap((clip) => {
      const retainedWords = cue.words.flatMap((word, wordIndex) => {
        const activeEvents = cue.events.filter(
          (event) => event.activeWordIndex === wordIndex,
        );
        const wordStartFrame = word.startFrame
          ?? Math.min(...activeEvents.map((event) => event.startFrame), cue.startFrame);
        const wordEndFrame = word.endFrame
          ?? Math.max(...activeEvents.map((event) => event.endFrame), cue.endFrame);
        const speechStartFrame = word.speechStartFrame ?? wordStartFrame;
        const speechEndFrame = word.speechEndFrame ?? wordEndFrame;
        const spokenVisibleStartFrame = Math.max(
          speechStartFrame,
          clip.startFrame,
        );
        const spokenVisibleEndFrame = Math.min(speechEndFrame, clip.endFrame);
        if (spokenVisibleEndFrame <= spokenVisibleStartFrame) return [];
        const visibleStartFrame = Math.max(wordStartFrame, clip.startFrame);
        const visibleEndFrame = Math.min(wordEndFrame, clip.endFrame);
        if (visibleEndFrame <= visibleStartFrame) return [];
        return [{
          originalIndex: wordIndex,
          word: {
            ...word,
            startFrame: clip.outputStartFrame
              + visibleStartFrame
              - clip.startFrame,
            endFrame: clip.outputStartFrame
              + visibleEndFrame
              - clip.startFrame,
            speechStartFrame: clip.outputStartFrame
              + spokenVisibleStartFrame
              - clip.startFrame,
            speechEndFrame: clip.outputStartFrame
              + spokenVisibleEndFrame
              - clip.startFrame,
          },
        }];
      });
      if (retainedWords.length === 0) return [];
      const retainedIndexByOriginal = new Map(
        retainedWords.map((entry, index) => [entry.originalIndex, index]),
      );
      const events = cue.events.flatMap((event) => {
        const activeWordIndex = event.activeWordIndex == null
          ? undefined
          : retainedIndexByOriginal.get(event.activeWordIndex);
        if (event.activeWordIndex != null && activeWordIndex == null) return [];
        const visibleStartFrame = Math.max(event.startFrame, clip.startFrame);
        const visibleEndFrame = Math.min(event.endFrame, clip.endFrame);
        if (visibleEndFrame <= visibleStartFrame) return [];
        const positions = event.positions
          ? retainedWords.flatMap((entry) => {
              const position = event.positions?.[entry.originalIndex];
              return position ? [{ ...position }] : [];
            })
          : undefined;
        if (positions?.length) {
          const centerX = spec.safeArea.x + spec.safeArea.width / 2;
          const visibleCenterX = (
            Math.min(...positions.map((position) => position.centerX))
            + Math.max(...positions.map((position) => position.centerX))
          ) / 2;
          for (const position of positions) {
            position.centerX += centerX - visibleCenterX;
          }
        }
        return [{
          ...event,
          ...(activeWordIndex == null ? {} : { activeWordIndex }),
          ...(positions ? { positions } : {}),
          startFrame: clip.outputStartFrame
            + visibleStartFrame
            - clip.startFrame,
          endFrame: clip.outputStartFrame
            + visibleEndFrame
            - clip.startFrame,
        }];
      });
      if (events.length === 0) return [];
      const lines = cue.lines?.flatMap((line) => {
        const retainedLine = line.flatMap((wordIndex) => {
          const retainedIndex = retainedIndexByOriginal.get(wordIndex);
          return retainedIndex == null ? [] : [retainedIndex];
        });
        return retainedLine.length ? [retainedLine] : [];
      });
      return [{
        ...cue,
        sourceCueIndex: cue.sourceCueIndex ?? cueIndex,
        startFrame: Math.min(...events.map((event) => event.startFrame)),
        endFrame: Math.max(...events.map((event) => event.endFrame)),
        words: retainedWords.map((entry) => entry.word),
        ...(lines ? { lines } : {}),
        events,
      }];
    })
  )).sort((left, right) => left.startFrame - right.startFrame);

  return cues.length > 0 ? { ...spec, cues } : null;
}
