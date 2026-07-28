import { describe, expect, it } from "vitest";
import {
  calculateReferralCommission,
  isReferralLoginId,
  isReferralSlug,
  maskedReferralEmail,
  normalizeReferralCampaign,
} from "@/lib/referral-policy";

describe("referral policy", () => {
  it("validates slugs and blocks application routes", () => {
    expect(isReferralSlug("creator-one")).toBe(true);
    expect(isReferralSlug("Creator-One")).toBe(true);
    expect(isReferralSlug("admin")).toBe(false);
    expect(isReferralSlug("123")).toBe(false);
    expect(isReferralSlug("bad--slug")).toBe(false);
  });

  it("validates partner login ids", () => {
    expect(isReferralLoginId("creator.01")).toBe(true);
    expect(isReferralLoginId("1creator")).toBe(false);
    expect(isReferralLoginId("ab")).toBe(false);
  });

  it("calculates commission from the post-refund amount and floors won", () => {
    expect(calculateReferralCommission(9_900, 0, 2_000)).toBe(1_980);
    expect(calculateReferralCommission(9_999, 1_111, 1_333)).toBe(1_184);
    expect(calculateReferralCommission(1_000, 2_000, 2_000)).toBe(0);
  });

  it("normalizes campaigns and masks member emails", () => {
    expect(normalizeReferralCampaign(" youtube-01 ")).toBe("youtube-01");
    expect(normalizeReferralCampaign("not valid")).toBeNull();
    expect(maskedReferralEmail("creator@example.com")).toBe("cr*****@example.com");
  });
});
