"use client";

import type { ConversionEvent } from "./conversion-events";

export function trackConversion(event: Omit<ConversionEvent, "id">) {
  // Analytics must never interrupt navigation, checkout, or downloads.
  try {
    if (typeof window === "undefined") return;
    void fetch("/api/conversion-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({ ...event, id: crypto.randomUUID() }),
    }).catch(() => undefined);
  } catch { /* Unsupported browser or blocked measurement: continue the action. */ }
}
