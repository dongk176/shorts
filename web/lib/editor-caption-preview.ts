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
  const clipWindows = clips.flatMap((clip) => {
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

  const cues = spec.cues.flatMap((cue, cueIndex) => {
    const events = clipWindows.flatMap((clip) => (
      cue.events.flatMap((event) => {
        const visibleStartFrame = Math.max(event.startFrame, clip.startFrame);
        const visibleEndFrame = Math.min(event.endFrame, clip.endFrame);
        if (visibleEndFrame <= visibleStartFrame) return [];
        return [{
          ...event,
          startFrame: clip.outputStartFrame
            + visibleStartFrame
            - clip.startFrame,
          endFrame: clip.outputStartFrame
            + visibleEndFrame
            - clip.startFrame,
        }];
      })
    ));
    if (events.length === 0) return [];
    return [{
      ...cue,
      sourceCueIndex: cue.sourceCueIndex ?? cueIndex,
      startFrame: Math.min(...events.map((event) => event.startFrame)),
      endFrame: Math.max(...events.map((event) => event.endFrame)),
      events,
    }];
  });

  return cues.length > 0 ? { ...spec, cues } : null;
}
