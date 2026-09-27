import type { User } from "@supabase/supabase-js";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { requireMvpSession } from "@/lib/session";
import { canDownloadStrategyGuides } from "./access";

export async function getStrategyLibraryAccess(
  user: User | null,
): Promise<"guest" | "paid" | "free" | "unavailable"> {
  if (!user) return "guest";
  try {
    // Billing is keyed by app_users.id, not the identity provider's user ID.
    const session = await requireMvpSession(user, {
      readOnly: true,
      createIfMissing: false,
    });
    return canDownloadStrategyGuides(
      await getBillingSummary(getDb(), session.userId),
    )
      ? "paid"
      : "free";
  } catch {
    return "unavailable";
  }
}
