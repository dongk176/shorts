import { describe, expect, it } from "vitest";
import { discoverySince, latestPublishableDiscoverySlot } from "./youtube-discovery-time";

describe("17:20 KST collection rollover", () => {
  it.each([
    ["2026-09-11T23:59:59+09:00", "2026-09-11T17:10:00+09:00"],
    ["2026-09-12T00:00:00+09:00", "2026-09-11T17:10:00+09:00"],
    ["2026-09-12T05:10:00+09:00", "2026-09-11T17:10:00+09:00"],
    ["2026-09-12T17:19:59.999+09:00", "2026-09-11T17:10:00+09:00"],
    ["2026-09-12T17:20:00+09:00", "2026-09-12T17:10:00+09:00"],
    ["2027-01-01T00:00:00+09:00", "2026-12-31T17:10:00+09:00"],
    ["2028-03-01T17:19:59+09:00", "2028-02-29T17:10:00+09:00"],
  ])("at %s permits the search beginning %s", (now, expected) => {
    expect(latestPublishableDiscoverySlot(new Date(now))).toEqual(new Date(expected));
  });
  it("keeps calendar discovery dates unchanged", () => {
    expect(discoverySince("today", new Date("2026-09-12T00:00:00+09:00")))
      .toEqual(new Date("2026-09-12T00:00:00+09:00"));
  });
});
