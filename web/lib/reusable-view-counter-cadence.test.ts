import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextReusableDiscoveryAt } from "./youtube-discovery-time";

describe("counter follows the production reusable search cadence", () => {
  it("matches Korea's actual search cron and Japan's afternoon follow-up", () => {
    const { crons } = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
    expect(crons.find((cron: { path: string }) => cron.path === "/api/cron/youtube-discovery?lane=reusable").schedule).toBe("10 8,20 * * *");
    expect(crons.find((cron: { path: string }) => cron.path === "/api/cron/youtube-japan").schedule).toBe("15 8 * * *");
  });
  it.each([
    ["2026-09-12T08:09:59Z", "2026-09-12T08:10:00.000Z"],
    ["2026-09-12T08:10:00Z", "2026-09-12T20:10:00.000Z"],
    ["2026-09-12T08:12:00Z", "2026-09-12T20:10:00.000Z"],
    ["2026-09-12T08:18:00Z", "2026-09-12T20:10:00.000Z"],
    ["2026-09-12T15:00:00Z", "2026-09-12T20:10:00.000Z"],
    ["2026-09-12T20:10:00Z", "2026-09-13T08:10:00.000Z"],
  ])("keeps %s in the interval ending %s", (at, end) => {
    expect(nextReusableDiscoveryAt(new Date(at)).toISOString()).toBe(end);
  });
});
