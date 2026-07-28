"use server";

import { getDb } from "@/lib/db";
import {
  ONBOARDING_WELCOME_CAMPAIGN_CODE,
  ONBOARDING_WELCOME_PRODUCT_CODE,
  type OnboardingWelcomeAnnouncement,
} from "@/lib/onboarding-welcome";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export async function claimOnboardingWelcomeAnnouncement():
Promise<OnboardingWelcomeAnnouncement | null> {
  const session = await requireAuthenticatedMvpSession();
  const rows = await getDb()`
    update shorts_mvp.member_campaign_announcements announcement
    set presented_at=clock_timestamp()
    where announcement.user_id=${session.userId}
      and announcement.campaign_code=${ONBOARDING_WELCOME_CAMPAIGN_CODE}
      and announcement.presented_at is null
      and announcement.valid_until>clock_timestamp()
      and exists (
        select 1
        from shorts_mvp.usage_grants grant_row
        where grant_row.user_id=announcement.user_id
          and grant_row.product_code=${ONBOARDING_WELCOME_PRODUCT_CODE}
          and grant_row.status='active'
          and grant_row.valid_from<=clock_timestamp()
          and grant_row.expires_at>clock_timestamp()
          and grant_row.total_seconds
            > grant_row.reserved_seconds+grant_row.consumed_seconds
      )
    returning announcement.campaign_code,announcement.granted_seconds,
      announcement.valid_until
  `;
  const row = rows[0] as {
    campaignCode: string;
    grantedSeconds: number;
    validUntil: Date;
  } | undefined;
  if (!row || row.campaignCode !== ONBOARDING_WELCOME_CAMPAIGN_CODE) return null;
  return {
    campaignCode: ONBOARDING_WELCOME_CAMPAIGN_CODE,
    grantedSeconds: Number(row.grantedSeconds),
    validUntil: row.validUntil.toISOString(),
  };
}
