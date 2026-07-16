import { describe, expect, it } from "vitest";
import { isPlaybackAvailable, shortPlaybackVersionKey } from "@/lib/project-playback";

describe("project playback sources", () => {
  it("keeps the source key stable across job polling updates", () => {
    const before = { id: "short-1", renderVersion: 3, status: "ready" };
    const whileRerendering = { ...before, status: "rerendering", rerenderProgress: 42 };

    expect(shortPlaybackVersionKey(whileRerendering)).toBe(shortPlaybackVersionKey(before));
  });

  it("changes the source key only when a new render is available", () => {
    const current = { id: "short-1", renderVersion: 3 };
    const updated = { ...current, renderVersion: 4 };

    expect(shortPlaybackVersionKey(updated)).not.toBe(shortPlaybackVersionKey(current));
  });

  it("allows the current render while rerendering but not unavailable outputs", () => {
    expect(isPlaybackAvailable({ id: "short-1", renderVersion: 1, status: "ready" })).toBe(true);
    expect(isPlaybackAvailable({ id: "short-1", renderVersion: 1, status: "rerendering" })).toBe(true);
    expect(isPlaybackAvailable({ id: "short-1", renderVersion: 1, status: "rendering" })).toBe(false);
  });
});
