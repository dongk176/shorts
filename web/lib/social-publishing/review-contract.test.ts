import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { emptyTikTokIntent, missingPublishingScopes, proposedCallback, validateFacebookPageIntent, validateTikTokIntent } from "./review-contract";

const nowMs = 1_800_000_000_000;
const creator = { connectionId: "owned-channel", fetchedAtMs: nowMs, privacyOptions: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], maxDurationSeconds: 60, commentDisabled: true, duetDisabled: true, stitchDisabled: true };
const context = { nowMs, durationSeconds: 15, auditApproved: false };
const approvedIntent = () => ({ ...emptyTikTokIntent("owned-channel"), privacy: "SELF_ONLY", musicUsageConfirmed: true, rightsConfirmed: true, sendToTikTokConfirmed: true });

describe("publishing review contracts", () => {
  it("requires explicit privacy and transfer consent and starts interaction settings off", () => {
    const initial = emptyTikTokIntent("owned-channel");
    expect(initial).toMatchObject({ privacy: null, allowComments: false, allowDuet: false, allowStitch: false, discloseCommercialContent: false });
    expect(validateTikTokIntent(initial, creator, context)).toEqual(expect.arrayContaining(["choose_allowed_privacy", "explicit_transfer_consent_required"]));
    expect(validateTikTokIntent(approvedIntent(), creator, context)).toEqual([]);
  });
  it("rejects public upload before audit and stale or mismatched channel information", () => {
    expect(validateTikTokIntent({ ...approvedIntent(), privacy: "PUBLIC_TO_EVERYONE" }, creator, context)).toContain("audit_required_for_non_private");
    expect(validateTikTokIntent(approvedIntent(), { ...creator, connectionId: "another-user" }, context)).toContain("connection_mismatch");
    expect(validateTikTokIntent(approvedIntent(), { ...creator, fetchedAtMs: nowMs - 600_001 }, context)).toContain("refresh_creator_info");
    expect(validateTikTokIntent(approvedIntent(), { ...creator, fetchedAtMs: NaN }, context)).toContain("refresh_creator_info");
  });
  it("honors per-creator options and duration rather than universal platform limits", () => {
    expect(validateTikTokIntent({ ...approvedIntent(), allowComments: true, allowDuet: true, allowStitch: true }, creator, context)).toEqual(expect.arrayContaining(["comments_unavailable", "duet_unavailable", "stitch_unavailable"]));
    expect(validateTikTokIntent(approvedIntent(), creator, { ...context, durationSeconds: 61 })).toContain("unsupported_duration");
    expect(validateTikTokIntent({ ...approvedIntent(), privacy: "FRIENDS_ONLY" }, creator, context)).toContain("choose_allowed_privacy");
    expect(validateTikTokIntent(approvedIntent(), creator, { ...context, durationSeconds: NaN })).toContain("unsupported_duration");
  });
  it("requires valid commercial disclosure, prevents private branded posts", () => {
    expect(validateTikTokIntent({ ...approvedIntent(), discloseCommercialContent: true }, creator, context)).toContain("choose_commercial_content_type");
    expect(validateTikTokIntent({ ...approvedIntent(), brandedContent: true }, creator, context)).toEqual(expect.arrayContaining(["commercial_disclosure_required", "branded_content_cannot_be_private", "branded_content_policy_confirmation_required"]));
    expect(validateTikTokIntent({ ...approvedIntent(), privacy: "PUBLIC_TO_EVERYONE", discloseCommercialContent: true, brandedContent: true, brandedContentPolicyConfirmed: true }, creator, { ...context, auditApproved: true })).toEqual([]);
  });
  it("does not offer private Page reels or publish without Page content permissions", () => {
    expect(validateFacebookPageIntent({ accountType: "personal", tasks: [], audience: "PRIVATE", publicPostConfirmed: false })).toHaveLength(4);
    expect(validateFacebookPageIntent({ accountType: "page", tasks: ["CREATE_CONTENT"], audience: "PUBLIC", publicPostConfirmed: true })).toEqual([]);
  });
  it("uses Instagram Login scopes and rejects malformed callback origins", () => {
    expect(missingPublishingScopes("instagram", ["instagram_basic", "instagram_content_publish"])).toEqual(["instagram_business_basic", "instagram_business_content_publish"]);
    expect(proposedCallback("https://review.example.com", "threads")).toBe("https://review.example.com/api/social/threads/oauth/callback");
    for (const origin of ["http://localhost:3001", "https://localhost", "https://review.example.com/path", "https://user:pass@example.com", "https://example.com?x=1", "https://127.0.0.1"]) {
      expect(() => proposedCallback(origin, "tiktok")).toThrow();
    }
  });
});

