import type { CaptionRenderSpec } from "./caption-render-spec";
import type { EditorVideoClip } from "./editor-video-cuts";

const frameAt = (seconds: number, fps: number) => (
  Math.floor(seconds * fps + 0.5)
);

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

  const cues = spec.cues.flatMap((cue) => {
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
      startFrame: Math.min(...events.map((event) => event.startFrame)),
      endFrame: Math.max(...events.map((event) => event.endFrame)),
      events,
    }];
  });

  return cues.length > 0 ? { ...spec, cues } : null;
}
