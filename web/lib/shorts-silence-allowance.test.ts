import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { Sql } from "postgres";
import { manualRenderVersion } from "./shorts-silence-allowance";
import { onboardingWelcomeRerenderAllowed } from "./onboarding-welcome";
describe("automatic silence cleanup preserves trial correction", () => {
  it("leaves paid and unprocessed versions unchanged without a query", async () => {
    const db = vi.fn() as unknown as Sql;
    expect(await manualRenderVersion(db,"short",1,true)).toBe(1);
    expect(await manualRenderVersion(db,"short",10,false)).toBe(10);
    expect(db).not.toHaveBeenCalled();
  });
  it("exempts exactly one completed owned automatic render", async () => {
    const db = (async () => [{ automaticallyRendered: true }]) as unknown as Sql;
    expect(onboardingWelcomeRerenderAllowed(true, await manualRenderVersion(db,"short",2,true))).toBe(true);
    expect(onboardingWelcomeRerenderAllowed(true, await manualRenderVersion(db,"short",3,true))).toBe(false);
  });
  it("does not exempt a missing or failed automatic render", async () => {
    const db = (async () => [{ automaticallyRendered: false }]) as unknown as Sql;
    expect(onboardingWelcomeRerenderAllowed(true, await manualRenderVersion(db,"short",2,true))).toBe(false);
  });
});
