import type { Metadata, Viewport } from "next";
import { absoluteUrl, SITE_NAME } from "@/lib/seo";
import { CreatorSupportFlow } from "./creator-support-flow";

const title = "파트너 크리에이터 지원";
const description = "크리에이터의 다음 도전, 이지컷이 함께합니다. 매월 100분 × 3개월 무료 제작 지원.";
const previewImage = "/creator-support-og-20260912.png";
export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  openGraph: {
    type: "website", locale: "ko_KR", url: absoluteUrl("/creator-support"), siteName: SITE_NAME,
    title, description,
    images: [{ url: previewImage, width: 1730, height: 909, alt: "EASY CUT 파트너 크리에이터 · 매월 100분 × 3개월 무료 지원" }],
  },
  twitter: { card: "summary_large_image", title, description, images: [previewImage] },
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
