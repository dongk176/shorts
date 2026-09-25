import { notFound } from "next/navigation";
import { PaddlePage } from "@/components/paddle-page";
import { paddleEnabled } from "@/lib/paddle/config";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { authProfile } from "@/lib/session";
import { getRequestLocale } from "@/lib/i18n/server";
import { createNoIndexMetadata } from "@/lib/seo";
export const dynamic = "force-dynamic";
export const metadata = createNoIndexMetadata(
  "EasyCut checkout",
  "EasyCut subscription checkout",
);
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ _ptxn?: string }>;
}) {
  if (!paddleEnabled()) notFound();
  const params = await searchParams;
  const transactionId = params._ptxn;
  if (!transactionId || !/^txn_[a-z0-9]{26}$/.test(transactionId)) notFound();
  const user = await getAuthenticatedUser();
  return (
    <PaddlePage
      user={user ? authProfile(user) : null}
      locale={await getRequestLocale()}
      resumeId={transactionId}
    />
  );
}
