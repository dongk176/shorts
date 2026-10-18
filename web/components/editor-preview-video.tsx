"use client";
import { useEffect, useRef, type RefObject } from "react";
export type EditorPreviewPlayback = {
  videoRef?: RefObject<HTMLVideoElement | null>;
  onTimeChange?: (time: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onVideoError?: () => void;
  videoControls?: boolean;
};
export function EditorPreviewVideo({ src, start = 0, end, label, videoRef, onTimeChange, onPlayingChange, onVideoError, videoControls = true }: EditorPreviewPlayback & {
  src: string; start?: number; end?: number; label: string;
}) {
  const ownRef = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? ownRef;
  useEffect(() => {
    const video = ref.current;
    if (video && video.readyState >= 1 && (video.currentTime < start || (end !== undefined && video.currentTime > end))) {
      video.currentTime = start;
    }
  }, [ref, start, end]);
  return <video ref={ref} src={src} controls={videoControls} playsInline preload="metadata" aria-label={label}
    style={{ width: "100%", height: "100%", objectFit: "cover" }}
    onLoadedMetadata={e => { e.currentTarget.currentTime = start; onTimeChange?.(start); }}
    onPlay={e => {
      const video = e.currentTarget;
      if (video.currentTime < start || (end !== undefined && video.currentTime >= end)) video.currentTime = start;
      onPlayingChange?.(true);
    }}
    onPause={() => onPlayingChange?.(false)} onEnded={() => onPlayingChange?.(false)} onError={onVideoError}
    onTimeUpdate={e => {
      const video = e.currentTarget;
      if (end !== undefined && video.currentTime >= end) { video.pause(); if (video.currentTime > end) video.currentTime = end; }
      onTimeChange?.(video.currentTime);
    }} />;
}
