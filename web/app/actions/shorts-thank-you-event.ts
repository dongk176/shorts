"use server";

import { getDb } from "@/lib/db";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  claimShortsThankYouEventWelcome,
  type ShortsThankYouEventClaim,
} from "@/lib/shorts-thank-you-event";

export async function claimShortsThankYouEvent(): Promise<ShortsThankYouEventClaim> {
  const session = await requireAuthenticatedMvpSession();
  return claimShortsThankYouEventWelcome(getDb(), session.userId);
}
