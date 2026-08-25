import type { Metadata } from "next";
import { z } from "zod";
import { EnterprisePaymentFailClient } from "./fail-client";

export const metadata: Metadata = {
  title: "결제 미완료 | EasyCut",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ token: string }> };

export default async function EnterprisePaymentFailPage({ params }: PageProps) {
  const token = z.string().uuid().parse((await params).token);
  return <EnterprisePaymentFailClient token={token} />;
}
