"use server";

import { getDb } from "@/lib/db";
import {
  SIDEBAR_NAVIGATION_CAMPAIGN_CODE,
  type SidebarNavigationAnnouncement,
} from "@/lib/sidebar-navigation-announcement";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export async function claimSidebarNavigationAnnouncement():
Promise<SidebarNavigationAnnouncement | null> {
  const session = await requireAuthenticatedMvpSession();
  const rows = await getDb()`
    insert into shorts_mvp.member_ui_announcement_receipts (
      user_id,
      campaign_code
    )
    select
      u.id,
      c.campaign_code
    from shorts_mvp.app_users u
    join shorts_mvp.member_ui_announcement_campaigns c
      on c.campaign_code=${SIDEBAR_NAVIGATION_CAMPAIGN_CODE}
    where u.id=${session.userId}
      and c.enabled=true
      and u.created_at<c.eligibility_cutoff
    on conflict (user_id,campaign_code) do nothing
    returning campaign_code
  `;
  const campaignCode = rows[0]?.campaignCode;
  if (campaignCode !== SIDEBAR_NAVIGATION_CAMPAIGN_CODE) return null;
  return { campaignCode: SIDEBAR_NAVIGATION_CAMPAIGN_CODE };
}
