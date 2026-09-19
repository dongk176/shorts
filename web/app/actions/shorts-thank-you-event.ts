"use server";

import { getDb } from "@/lib/db";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { HttpError } from "@/lib/http";
import {
  claimShortsThankYouEventWelcome,
  type ShortsThankYouEventClaim,
} from "@/lib/shorts-thank-you-event";

export async function claimShortsThankYouEvent(): Promise<ShortsThankYouEventClaim> {
  const session = await requireAuthenticatedMvpSession().catch((error) => {
    // An expired login simply has no optional announcement to claim.
    if (error instanceof HttpError && error.status === 401) return null;
    throw error;
  });
  if (!session) return { enabled: false, welcomeClaimed: false, rewardAvailable: false };
  return claimShortsThankYouEventWelcome(getDb(), session.userId);
}
