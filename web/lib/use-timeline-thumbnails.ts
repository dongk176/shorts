"use client";

import { useEffect, useState } from "react";

export const timelineThumbnailCount = 12;

function waitForFrame(video: HTMLVideoElement, event: "loadedmetadata" | "seeked", signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener(event, ready);
      video.removeEventListener("error", failed);
      signal.removeEventListener("abort", failed);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Timeline thumbnail unavailable")); };
    const timeout = setTimeout(failed, 10_000);
    video.addEventListener(event, ready, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", failed, { once: true });
    if (signal.aborted) failed();
  });
}

export function useTimelineThumbnails(url: string) {
  const [result, setResult] = useState<{ url: string; frames: string[] }>({ url: "", frames: [] });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const { signal } = controller;
    // Decode separately so thumbnail seeks never move or pause the preview.
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const capture = async () => {
      const metadata = waitForFrame(video, "loadedmetadata", signal);
      video.src = url;
      video.load();
      await metadata;
      if (signal.aborted || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const canvas = document.createElement("canvas");
      canvas.width = 144;
      canvas.height = 81;
      const context = canvas.getContext("2d");
      if (!context) return;
      const frames: string[] = [];
      for (let index = 0; index < timelineThumbnailCount; index++) {
        if (signal.aborted) return;
        const seeked = waitForFrame(video, "seeked", signal);
        video.currentTime = Math.min(Math.max(0, video.duration - 0.05), video.duration * (index + 0.5) / timelineThumbnailCount);
        await seeked;
        if (signal.aborted) return;
        const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
        const width = video.videoWidth * scale;
        const height = video.videoHeight * scale;
        context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
        frames.push(canvas.toDataURL("image/jpeg", 0.72));
        setResult({ url, frames: [...frames] });
      }
    };
    // A thumbnail failure must leave trimming and playback usable.
    const releaseVideo = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
    void capture().catch(() => {}).finally(releaseVideo);
    return () => {
      controller.abort();
      releaseVideo();
    };
  }, [url]);
  return result.url === url ? result.frames : [];
}
