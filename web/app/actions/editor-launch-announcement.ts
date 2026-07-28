"use server";

import { getDb } from "@/lib/db";
import {
  EDITOR_LAUNCH_CAMPAIGN_CODE,
  type EditorLaunchAnnouncement,
} from "@/lib/editor-launch-announcement";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export async function claimEditorLaunchAnnouncement(): Promise<EditorLaunchAnnouncement | null> {
  const session = await requireAuthenticatedMvpSession();
  const rows = await getDb()`
    update shorts_mvp.member_campaign_announcements
    set presented_at=clock_timestamp()
    where user_id=${session.userId}
      and campaign_code=${EDITOR_LAUNCH_CAMPAIGN_CODE}
      and presented_at is null
      and valid_until>clock_timestamp()
    returning campaign_code,granted_seconds,valid_until
  `;
  const row = rows[0] as {
    campaignCode: string;
    grantedSeconds: number;
    validUntil: Date;
  } | undefined;
  if (!row || row.campaignCode !== EDITOR_LAUNCH_CAMPAIGN_CODE) return null;
  return {
    campaignCode: EDITOR_LAUNCH_CAMPAIGN_CODE,
    grantedSeconds: Number(row.grantedSeconds),
    validUntil: row.validUntil.toISOString(),
  };
}
