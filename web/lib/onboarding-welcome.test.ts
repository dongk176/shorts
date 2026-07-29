import { afterEach, describe, expect, it } from "vitest";
import {
  onboardingWelcomeGrantEnabled,
  onboardingWelcomeRerenderAllowed,
} from "./onboarding-welcome";

afterEach(() => {
  delete process.env.ONBOARDING_WELCOME_GRANT_ENABLED;
});

describe("onboarding welcome grant switch", () => {
  it("enables login grants by default", () => {
    expect(onboardingWelcomeGrantEnabled()).toBe(true);
  });

  it("pauses grants only with an explicit false value", () => {
    process.env.ONBOARDING_WELCOME_GRANT_ENABLED = " FALSE ";
    expect(onboardingWelcomeGrantEnabled()).toBe(false);
  });
});

describe("onboarding welcome rerender budget", () => {
  it("allows one correction after the initial free render", () => {
    expect(onboardingWelcomeRerenderAllowed(true, 1)).toBe(true);
    expect(onboardingWelcomeRerenderAllowed(true, 2)).toBe(false);
  });

  it("does not limit paid or otherwise funded projects", () => {
    expect(onboardingWelcomeRerenderAllowed(false, 100)).toBe(true);
  });
});
