import type { Metadata, Viewport } from "next";
import { CreatorSupportFlow } from "./creator-support-flow";

export const metadata: Metadata = {
  title: "파트너 크리에이터 지원",
  description: "채널 소개·광고 활용에 참여하고, 매월 30분씩 3개월간 이지컷 사용량을 지원받으세요.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, interactiveWidget: "resizes-content" };
export const dynamic = "force-dynamic";
export default function CreatorSupportPage() { return <CreatorSupportFlow />; }
