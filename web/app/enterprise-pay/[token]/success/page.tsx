import type { Metadata } from "next";
import { z } from "zod";
import { EnterprisePaymentSuccessClient } from "./success-client";

export const metadata: Metadata = {
  title: "결제 결과 확인 | EasyCut",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ token: string }> };

export default async function EnterprisePaymentSuccessPage({ params }: PageProps) {
  const token = z.string().uuid().parse((await params).token);
  return <EnterprisePaymentSuccessClient token={token} />;
}
