import { describe, expect, it } from "vitest";
import {
  canSplitEditorVideoAtTime,
  createEditorVideoClips,
  deleteEditorVideoClip,
  editorVideoDuration,
  editorVideoOutputTimeForSource,
  editorVideoPlaybackBoundaryTransition,
  locateEditorVideoTime,
  splitEditorVideoAtTime,
} from "./editor-video-cuts";

describe("editor video cuts", () => {
  it("splits the clip at the current output time", () => {
    const initial = createEditorVideoClips(5, 35);
    const result = splitEditorVideoAtTime(initial, 12, "video-clip-2");

    expect(result).toEqual({
      clips: [
        {
          id: "video-clip-1",
          sourceStartSeconds: 5,
          sourceEndSeconds: 17,
        },
        {
          id: "video-clip-2",
          sourceStartSeconds: 17,
          sourceEndSeconds: 35,
        },
      ],
      selectedClipId: "video-clip-1",
    });
  });

  it("does not create an unusably short clip", () => {
    const clips = createEditorVideoClips(0, 10);

    expect(canSplitEditorVideoAtTime(clips, 0.1)).toBe(false);
    expect(canSplitEditorVideoAtTime(clips, 0.15)).toBe(true);
    expect(canSplitEditorVideoAtTime(clips, 9.9)).toBe(false);
  });

  it("ripples later clips forward after deleting a middle clip", () => {
    const clips = [
      { id: "a", sourceStartSeconds: 0, sourceEndSeconds: 10 },
      { id: "b", sourceStartSeconds: 10, sourceEndSeconds: 20 },
      { id: "c", sourceStartSeconds: 20, sourceEndSeconds: 30 },
    ];
    const result = deleteEditorVideoClip(clips, "b");

    expect(result).toMatchObject({
      clips: [clips[0], clips[2]],
      removedOutputStartSeconds: 10,
      selectedClipId: "c",
    });
    expect(editorVideoDuration(result?.clips || [])).toBe(20);
    expect(locateEditorVideoTime(result?.clips || [], 12)?.sourceSeconds).toBe(22);
  });

  it("maps source playback back to the joined output timeline", () => {
    const clips = [
      { id: "a", sourceStartSeconds: 3, sourceEndSeconds: 8 },
      { id: "b", sourceStartSeconds: 20, sourceEndSeconds: 30 },
    ];

    expect(editorVideoOutputTimeForSource(clips, 1, 23)).toBe(8);
    expect(locateEditorVideoTime(clips, 5)?.sourceSeconds).toBe(20);
  });

  it("does not seek backward at a contiguous split boundary", () => {
    const clips = [
      { id: "a", sourceStartSeconds: 0, sourceEndSeconds: 5 },
      { id: "b", sourceStartSeconds: 5, sourceEndSeconds: 10 },
    ];

    expect(editorVideoPlaybackBoundaryTransition(clips, 0, 5.08, 0.02))
      .toEqual({ nextClipIndex: 1, seekSourceSeconds: null });
  });

  it("seeks directly across a deleted source range before it is displayed", () => {
    const clips = [
      { id: "a", sourceStartSeconds: 0, sourceEndSeconds: 5 },
      { id: "b", sourceStartSeconds: 8, sourceEndSeconds: 10 },
    ];

    expect(editorVideoPlaybackBoundaryTransition(clips, 0, 4.985, 0.02))
      .toEqual({ nextClipIndex: 1, seekSourceSeconds: 8 });
  });

  it("loops from the last clip without waiting for a sparse timeupdate", () => {
    const clips = [
      { id: "a", sourceStartSeconds: 3, sourceEndSeconds: 5 },
    ];

    expect(editorVideoPlaybackBoundaryTransition(clips, 0, 4.985, 0.02))
      .toEqual({ nextClipIndex: 0, seekSourceSeconds: 3 });
  });

  it("keeps at least one video clip", () => {
    expect(deleteEditorVideoClip(createEditorVideoClips(0, 10), "video-clip-1"))
      .toBeNull();
  });

  it("keeps the requested minimum final duration", () => {
    const clips = [
      { id: "short", sourceStartSeconds: 0, sourceEndSeconds: 0.5 },
      { id: "long", sourceStartSeconds: 0.5, sourceEndSeconds: 10 },
    ];

    expect(deleteEditorVideoClip(clips, "long", 1)).toBeNull();
  });
});
