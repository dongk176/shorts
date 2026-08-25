import type { Metadata } from "next";
import { z } from "zod";
import { EnterpriseBillingFailClient } from "./fail-client";

export const metadata: Metadata = {
  title: "카드등록 미완료 | EasyCut",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ token: string }> };

export default async function EnterpriseBillingFailPage({ params }: PageProps) {
  const token = z.string().uuid().parse((await params).token);
  return <EnterpriseBillingFailClient token={token} />;
}
