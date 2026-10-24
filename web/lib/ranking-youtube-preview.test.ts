import { afterEach, describe, expect, it, vi } from "vitest";
import { createYouTubePreview } from "./ranking-youtube-preview";

function setup(muted = false) {
  vi.useFakeTimers();
  const player = {
    seekTo: vi.fn(),
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    getPlayerState: vi.fn(() => 3),
    getCurrentTime: vi.fn(() => 0),
    isMuted: vi.fn(() => muted),
    mute: vi.fn(),
    unMute: vi.fn(),
  };
  const timeout = vi.fn();
  return { player, timeout, preview: createYouTubePreview(player, timeout) };
}
afterEach(() => vi.useRealTimers());
describe("YouTube timeline preview", () => {
  it("waits for a playing frame at the selected time before pausing a cold video", () => {
    const { player, preview } = setup();
    preview.seek(4.467);
    vi.advanceTimersByTime(500);
    expect(player.mute).toHaveBeenCalled();
    expect(player.playVideo).toHaveBeenCalledOnce();
    expect(player.pauseVideo).not.toHaveBeenCalled();
    player.getPlayerState.mockReturnValue(1);
    player.getCurrentTime.mockReturnValue(4.5);
    vi.advanceTimersByTime(200);
    expect(player.pauseVideo).toHaveBeenCalledOnce();
    expect(player.unMute).toHaveBeenCalledOnce();
    expect(preview.seeking).toBe(false);
  });
  it("coalesces drag events and ignores frames belonging to an older seek", () => {
    const { player, preview } = setup(true);
    preview.seek(2);
    vi.advanceTimersByTime(100);
    preview.seek(4);
    preview.seek(8);
    vi.advanceTimersByTime(100);
    expect(player.seekTo.mock.calls).toEqual([
      [2, true],
      [8, true],
    ]);
    player.getPlayerState.mockReturnValue(1);
    player.getCurrentTime.mockReturnValue(2);
    vi.advanceTimersByTime(300);
    expect(player.pauseVideo).not.toHaveBeenCalled();
    player.getCurrentTime.mockReturnValue(8.1);
    vi.advanceTimersByTime(200);
    expect(player.pauseVideo).toHaveBeenCalledOnce();
    expect(player.unMute).not.toHaveBeenCalled();
  });
  it("explicit playback cancels pending preview pauses, even during debounce", () => {
    const { player, preview } = setup();
    preview.seek(4);
    preview.play();
    vi.advanceTimersByTime(10000);
    expect(player.seekTo).toHaveBeenCalledWith(4, true);
    expect(player.playVideo).toHaveBeenCalledOnce();
    expect(player.pauseVideo).not.toHaveBeenCalled();
    expect(preview.seeking).toBe(false);
  });
  it("bounds failed loads and cancels callbacks when the player is removed", () => {
    const { player, timeout, preview } = setup();
    preview.seek(5);
    vi.advanceTimersByTime(8200);
    expect(timeout).toHaveBeenCalledOnce();
    expect(player.pauseVideo).toHaveBeenCalledOnce();
    preview.seek(6);
    preview.dispose();
    vi.advanceTimersByTime(10000);
    expect(player.seekTo).toHaveBeenCalledTimes(1);
  });
});
