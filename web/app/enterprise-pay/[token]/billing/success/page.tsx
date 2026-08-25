import type { Metadata } from "next";
import { z } from "zod";
import { EnterpriseBillingSuccessClient } from "./success-client";

export const metadata: Metadata = {
  title: "카드등록 및 결제 확인 | EasyCut",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ token: string }> };

export default async function EnterpriseBillingSuccessPage({ params }: PageProps) {
  const token = z.string().uuid().parse((await params).token);
  return <EnterpriseBillingSuccessClient token={token} />;
}
