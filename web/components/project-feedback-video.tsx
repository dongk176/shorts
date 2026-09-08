"use client";

import { type ComponentProps, useEffect, useRef } from "react";
import { useUsageState } from "@/components/usage-provider";
import {
  createProjectFeedbackPlaybackTracker,
  markCompletedProjectViewedForFeedback,
} from "@/lib/project-feedback-client";

type Props = ComponentProps<"video"> & {
  projectNumber: number;
  feedbackEnabled: boolean;
};

export function ProjectFeedbackVideo({ projectNumber, feedbackEnabled, ...props }: Props) {
  const { authenticated, accountId } = useUsageState();
  const playback = useRef({
    identity: "",
    observe: createProjectFeedbackPlaybackTracker(),
    recorded: false,
  });
  useEffect(() => {
    const resetSample = () => { playback.current.observe(0, false); };
    document.addEventListener("visibilitychange", resetSample);
    return () => document.removeEventListener("visibilitychange", resetSample);
  }, []);

  return <video
    {...props}
    onPause={(event) => {
      playback.current.observe(0, false);
      props.onPause?.(event);
    }}
    onSeeking={(event) => {
      playback.current.observe(0, false);
      props.onSeeking?.(event);
    }}
    onTimeUpdate={(event) => {
      const identity = `${accountId}:${projectNumber}`;
      if (playback.current.identity !== identity) {
        playback.current = { identity, observe: createProjectFeedbackPlaybackTracker(), recorded: false };
      }
      const video = event.currentTarget;
      const active = feedbackEnabled && authenticated && Boolean(accountId)
        && document.visibilityState === "visible"
        && !video.paused && !video.seeking && video.readyState >= 2;
      if (!playback.current.recorded && playback.current.observe(video.currentTime, active) && accountId) {
        markCompletedProjectViewedForFeedback(accountId, projectNumber);
        playback.current.recorded = true;
      }
      props.onTimeUpdate?.(event);
    }}
  />;
}
