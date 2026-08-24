export const ONBOARDING_WELCOME_CAMPAIGN_CODE = "onboarding_welcome_v1";
export const ONBOARDING_WELCOME_PRODUCT_CODE = "onboarding_welcome_20min_v1";
export const LOGIN_WELCOME_GRANT_FLAG_KEY = "login_welcome_grant";
export const ONBOARDING_WELCOME_GRANT_SECONDS = 20 * 60;
export const ONBOARDING_WELCOME_GRANT_VALIDITY_DAYS = 30;
export const ONBOARDING_WELCOME_MAX_RERENDERS = 1;

export function onboardingWelcomeGrantEnabled() {
  return process.env.ONBOARDING_WELCOME_GRANT_ENABLED?.trim().toLowerCase() !== "false";
}

export function onboardingWelcomeRerenderAllowed(
  fundedByWelcomeGrant: boolean,
  renderVersion: number,
) {
  return !fundedByWelcomeGrant
    || renderVersion < 1 + ONBOARDING_WELCOME_MAX_RERENDERS;
}

export type OnboardingWelcomeAnnouncement = {
  campaignCode: typeof ONBOARDING_WELCOME_CAMPAIGN_CODE;
  grantedSeconds: number;
  validUntil: string;
};
