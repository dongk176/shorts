import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { PayPalOrderResult } from "@/components/paypal-order-result";
import { getRequestLocale } from "@/lib/i18n/server";
export const dynamic = "force-dynamic";
export default async function OrderReturn({ searchParams }: { searchParams: Promise<{ checkout?: string; cancelled?: string }> }) {
  const params = await searchParams;
  const id = z.string().uuid().parse(params.checkout);
  if (!await getAuthenticatedUser()) redirect(`/auth/sign-in?next=${encodeURIComponent(`/billing/paypal/order?checkout=${id}${params.cancelled === "1" ? "&cancelled=1" : ""}`)}`);
  return <PayPalOrderResult checkoutId={id} canceled={params.cancelled === "1"} japanese={await getRequestLocale() === "ja"} />;
}
