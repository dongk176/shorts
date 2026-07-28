import { describe, expect, it } from "vitest";
import { onboardingWelcomeRerenderAllowed } from "./onboarding-welcome";

describe("onboarding welcome rerender budget", () => {
  it("allows one correction after the initial free render", () => {
    expect(onboardingWelcomeRerenderAllowed(true, 1)).toBe(true);
    expect(onboardingWelcomeRerenderAllowed(true, 2)).toBe(false);
  });

  it("does not limit paid or otherwise funded projects", () => {
    expect(onboardingWelcomeRerenderAllowed(false, 100)).toBe(true);
  });
});
