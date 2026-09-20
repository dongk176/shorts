/** Shared publishing constraints. TikTok's guarded local runtime uses these checks. */
export const publishingProviders = {
  instagram: {
    label: "Instagram",
    scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    accountType: "professional",
    review: ["meta-app-review"],
  },
  facebook: {
    label: "Facebook",
    scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
    accountType: "page",
    review: ["meta-app-review"],
  },
  threads: {
    label: "Threads",
    scopes: ["threads_basic", "threads_content_publish"],
    accountType: "threads-profile",
    review: ["meta-app-review"],
  },
  tiktok: {
    label: "TikTok",
    scopes: ["user.info.basic", "video.publish"],
    accountType: "tiktok-profile",
    review: ["tiktok-app-review", "tiktok-direct-post-audit"],
  },
} as const;
export type PublishingProvider = keyof typeof publishingProviders;

// Proposed routes, not deployed endpoints. Register only after the real route is tested.
export function proposedCallback(origin: string, provider: PublishingProvider): string {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || url.pathname !== "/" || !url.hostname.includes(".") || url.hostname.endsWith(".localhost")
      || url.hostname.endsWith(".local") || /^[\d.]+$/.test(url.hostname)) {
    throw new Error("A public HTTPS origin without a path is required.");
  }
  return `${url.origin}/api/social/${provider}/oauth/callback`;
}

export function missingPublishingScopes(provider: PublishingProvider, granted: readonly string[]): string[] {
  return publishingProviders[provider].scopes.filter(scope => !granted.includes(scope));
}

export type TikTokCreatorSnapshot = {
  // Must come from the provider immediately before rendering the publishing form.
  connectionId: string;
  fetchedAtMs: number;
  privacyOptions: readonly string[];
  maxDurationSeconds: number;
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
};
export type TikTokPostIntent = {
  connectionId: string;
  privacy: string | null;
  allowComments: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  discloseCommercialContent: boolean;
  yourBrand: boolean;
  brandedContent: boolean;
  musicUsageConfirmed: boolean;
  brandedContentPolicyConfirmed: boolean;
  rightsConfirmed: boolean;
  sendToTikTokConfirmed: boolean;
};

export function emptyTikTokIntent(connectionId: string): TikTokPostIntent {
  return {
    connectionId, privacy: null, allowComments: false, allowDuet: false, allowStitch: false,
    discloseCommercialContent: false, yourBrand: false, brandedContent: false,
    musicUsageConfirmed: false, brandedContentPolicyConfirmed: false,
    rightsConfirmed: false, sendToTikTokConfirmed: false,
  };
}

/** Pure checks; servers must parse untrusted input and reload their own snapshot. */
export function validateTikTokIntent(
  intent: TikTokPostIntent,
  creator: TikTokCreatorSnapshot,
  context: { nowMs: number; durationSeconds: number; auditApproved: boolean },
): string[] {
  const issues: string[] = [];
  if (!intent.connectionId || intent.connectionId !== creator.connectionId) issues.push("connection_mismatch");
  // Ten minutes is our freshness policy, not a claimed TikTok API limit.
  if (!Number.isFinite(creator.fetchedAtMs) || !Number.isFinite(context.nowMs)
      || creator.fetchedAtMs > context.nowMs || context.nowMs - creator.fetchedAtMs > 600_000) {
    issues.push("refresh_creator_info");
  }
  if (!intent.privacy || !creator.privacyOptions.includes(intent.privacy)) issues.push("choose_allowed_privacy");
  if (!context.auditApproved && intent.privacy !== "SELF_ONLY") issues.push("audit_required_for_non_private");
  if (!Number.isFinite(context.durationSeconds) || context.durationSeconds <= 0
      || !Number.isFinite(creator.maxDurationSeconds) || creator.maxDurationSeconds <= 0
      || context.durationSeconds > creator.maxDurationSeconds) issues.push("unsupported_duration");
  if (intent.allowComments && creator.commentDisabled) issues.push("comments_unavailable");
  if (intent.allowDuet && creator.duetDisabled) issues.push("duet_unavailable");
  if (intent.allowStitch && creator.stitchDisabled) issues.push("stitch_unavailable");
  if (!intent.musicUsageConfirmed) issues.push("music_confirmation_required");
  if (!intent.rightsConfirmed) issues.push("content_rights_confirmation_required");
  if (!intent.sendToTikTokConfirmed) issues.push("explicit_transfer_consent_required");
  if (intent.discloseCommercialContent && !intent.yourBrand && !intent.brandedContent) {
    issues.push("choose_commercial_content_type");
  }
  if (!intent.discloseCommercialContent && (intent.yourBrand || intent.brandedContent)) issues.push("commercial_disclosure_required");
  if (intent.brandedContent && intent.privacy === "SELF_ONLY") issues.push("branded_content_cannot_be_private");
  if (intent.brandedContent && !intent.brandedContentPolicyConfirmed) issues.push("branded_content_policy_confirmation_required");
  return issues;
}

/** Page reels have a public audience. A YouTube private option must not be reused. */
export function validateFacebookPageIntent(input: {
  accountType: string; tasks: readonly string[]; audience: string; publicPostConfirmed: boolean;
}): string[] {
  return [
    ...(input.accountType !== "page" ? ["facebook_page_required"] : []),
    ...(!input.tasks.includes("CREATE_CONTENT") ? ["page_create_content_task_required"] : []),
    ...(input.audience !== "PUBLIC" ? ["page_reels_are_public"] : []),
    ...(!input.publicPostConfirmed ? ["public_post_confirmation_required"] : []),
  ];
}
