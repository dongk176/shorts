"use client";
import { browserTrafficBytes } from "@/lib/media-traffic-browser";
import { useEffect } from "react";
import manifest from "@/lib/ranking-showroom-delivery.json";
export function MediaTrafficObserver() {
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    const assets = new Map(
      Object.entries(manifest.assets).map(([key, a]) => [
        `${manifest.origin}/${a.path}`,
        key,
      ]),
    );
    const queue: {
      id: string;
      resource: string;
      purpose: "home_example";
      bytes: number | null;
      interrupted: boolean;
    }[] = [];
    let sent = 0;
    const flush = () => {
      if (!queue.length || sent >= 100) return;
      const events = queue.splice(0, 20);
      sent += events.length;
      void fetch("/api/media-traffic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
        keepalive: true,
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    };
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const item = entry as PerformanceResourceTiming;
        const key = assets.get(item.name);
        if (!key || sent + queue.length >= 100) continue;
        // A hidden cross-origin timing is unknown, never a zero-byte cache hit.
        const bytes = browserTrafficBytes(item);
        queue.push({
          id: crypto.randomUUID(),
          resource: key,
          purpose: "home_example",
          bytes,
          interrupted: false,
        });
      }
    });
    try {
      observer.observe({ type: "resource", buffered: true });
    } catch {
      return;
    }
    const timer = setInterval(flush, 15000);
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    return () => {
      observer.disconnect();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  return null;
}
