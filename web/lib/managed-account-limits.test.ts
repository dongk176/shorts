import { describe, expect, it } from "vitest";
import {
  MANAGED_ACCOUNT_DEFAULT_ACTIVE_JOBS,
  resolveManagedAccountMaxActiveJobs,
} from "@/lib/managed-account-limits";

describe("managed-account concurrent job limits", () => {
  it("keeps administrator values within the supported range", () => {
    expect(resolveManagedAccountMaxActiveJobs(1)).toBe(1);
    expect(resolveManagedAccountMaxActiveJobs(7)).toBe(7);
    expect(resolveManagedAccountMaxActiveJobs(10)).toBe(10);
    expect(resolveManagedAccountMaxActiveJobs(30)).toBe(30);
  });

  it.each([0, 31, 1.5, null, undefined, "invalid"])(
    "falls back safely for %j",
    (value) => {
      expect(resolveManagedAccountMaxActiveJobs(value))
        .toBe(MANAGED_ACCOUNT_DEFAULT_ACTIVE_JOBS);
    },
  );
});
