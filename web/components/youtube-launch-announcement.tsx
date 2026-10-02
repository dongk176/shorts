"use client";

import { useEffect } from "react";
import { useWelcomeOverlayStage } from "./welcome-overlay-queue";

export function YoutubeLaunchAnnouncement() {
  const { active, complete } = useWelcomeOverlayStage("youtube-launch");

  // Automatic launch announcements are retired. Advance the queue so the
  // remaining onboarding can continue without mounting the YouTube guide.
  useEffect(() => {
    if (active) complete();
  }, [active, complete]);

  return null;
}
