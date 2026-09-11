import type { Metadata, Viewport } from "next";
import { CreatorSupportFlow } from "./creator-support-flow";

export const metadata: Metadata = {
  title: "파트너 크리에이터 지원",
  description: "이지컷 파트너 크리에이터를 위한 무료 제작 지원 프로그램.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, interactiveWidget: "resizes-content" };
export const dynamic = "force-dynamic";
export default async function CreatorSupportPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const failed = params.auth_error === "AUTH_START_FAILED" || params.auth_error === "AUTH_CALLBACK_FAILED";
  const authError = !failed ? "" : params.auth_error === "AUTH_START_FAILED"
    ? "로그인을 시작하지 못했어요. 아래에서 다시 시도해 주세요."
    : "로그인을 완료하지 못했어요. 아래에서 다시 시도해 주세요.";
  return <CreatorSupportFlow startAtAccount={params.step === "account" || failed} initialAuthError={authError} />;
}
