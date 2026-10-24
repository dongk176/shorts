export type YouTubePreviewPlayer = {
  seekTo: (time: number, ahead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getPlayerState: () => number;
  getCurrentTime: () => number;
  isMuted: () => boolean;
  mute: () => void;
  unMute: () => void;
};

// A cued YouTube video has no decoded frame. Let a muted seek render before
// pausing, and coalesce drag events so an older seek cannot pause a newer one.
export function createYouTubePreview(
  player: YouTubePreviewPlayer,
  onTimeout: () => void,
) {
  let target: number | null = null;
  let mutedBefore = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  function clear() {
    clearTimeout(debounce);
    clearInterval(poll);
  }
  function restore() {
    if (!mutedBefore) player.unMute();
  }
  function finish() {
    clear();
    player.pauseVideo();
    target = null;
    restore();
  }
  return {
    get seeking() {
      return target !== null;
    },
    seek(time: number) {
      if (target === null) mutedBefore = player.isMuted();
      target = time;
      clear();
      player.mute();
      debounce = setTimeout(() => {
        player.seekTo(time, true);
        player.playVideo();
        const deadline = Date.now() + 8000;
        let readyAt: number | null = null;
        poll = setInterval(() => {
          const current = player.getCurrentTime();
          if (
            player.getPlayerState() === 1 &&
            current >= time - 0.1 &&
            current < time + 1.5
          ) {
            readyAt ??= Date.now();
            if (Date.now() - readyAt >= 120) finish();
          } else readyAt = null;
          if (target !== null && Date.now() >= deadline) {
            finish();
            onTimeout();
          }
        }, 40);
      }, 80);
    },
    play() {
      clear();
      if (target !== null) {
        player.seekTo(target, true);
        target = null;
        restore();
      }
      player.playVideo();
    },
    pause() {
      clear();
      player.pauseVideo();
      if (target !== null) {
        target = null;
        restore();
      }
    },
    dispose() {
      clear();
      target = null;
    },
  };
}
