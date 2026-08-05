import { afterEach, describe, expect, it } from "vitest";
import { resolveSourceRangeReleaseAccess } from "@/lib/source-range-release";

describe("source range release access", () => {
  afterEach(() => {
    delete process.env.SOURCE_RANGE_SELECTION_ENABLED;
  });

  it("keeps everyone on the legacy path when the master switch is off", () => {
    expect(resolveSourceRangeReleaseAccess({
      masterEnabled: false,
      featureEnabled: true,
      publicEnabled: true,
      isAdmin: true,
    }).enabled).toBe(false);
  });

  it("admits only administrators before public promotion", () => {
    expect(resolveSourceRangeReleaseAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: false,
      isAdmin: true,
    }).enabled).toBe(true);
    expect(resolveSourceRangeReleaseAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: false,
      isAdmin: false,
    }).enabled).toBe(false);
  });

  it("admits everyone only after the public flag is enabled", () => {
    expect(resolveSourceRangeReleaseAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: true,
      isAdmin: false,
    }).enabled).toBe(true);
  });
});
