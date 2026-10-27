import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { requireRankingUser } from "@/lib/ranking-access";
import { HttpError } from "@/lib/http";
import { RankingOnboarding } from "@/components/ranking-onboarding-preview";
import { RankingStudio } from "./ranking-studio";
import "./ranking-shorts.css";
import "./ranking-popular-picker.css";
import "./ranking-editor-ui.css";
import "./ranking-framing.css";
import { FixedPreview } from "./ranking-fixed-preview";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "랭킹 쇼츠 | EasyCut",
  robots: { index: false, follow: false },
};
export default async function RankingShortsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; operation?: string }>;
}) {
  let ownerId: string;
  try {
    ownerId = (await requireRankingUser()).id;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect("/auth/sign-in?next=%2Franking-shorts");
    if (error instanceof HttpError && [403, 404].includes(error.status))
      notFound();
    throw error;
  }
  const { project, operation } = await searchParams;
  return (
    <div className="app-shell ranking-refreshed ranking-page-shell site-chrome desktop-sidebar-layout min-h-screen text-neutral-100">
      <SiteHeader desktopSidebar showUsageIndicator={false}>
        <Link href="/">롱폼 → 숏폼으로 이동</Link>
      </SiteHeader>
      <RankingStudio
        refreshedDesign
        ownerId={ownerId}
        key={`${project || "new"}:${operation || "latest"}`}
        initialProject={project || null}
        initialOperation={operation || null}
      />
      <FixedPreview />
      <RankingOnboarding mode="studio" ownerId={ownerId} />
    </div>
  );
}
