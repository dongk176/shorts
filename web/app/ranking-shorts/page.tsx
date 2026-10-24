import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { requireRankingAdmin } from "@/lib/ranking-access";
import { HttpError } from "@/lib/http";
import { RankingStudio } from "./ranking-studio";
import "./ranking-shorts.css";
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
    ownerId = (await requireRankingAdmin()).id;
  } catch (error) {
    if (error instanceof HttpError && [401, 403, 404].includes(error.status))
      notFound();
    throw error;
  }
  const { project, operation } = await searchParams;
  return (
    <div className="app-shell site-chrome desktop-sidebar-layout min-h-screen text-neutral-100">
      <SiteHeader desktopSidebar showUsageIndicator={false}>
        <Link href="/">롱폼 → 숏폼으로 이동</Link>
      </SiteHeader>
      <RankingStudio
        ownerId={ownerId}
        key={`${project || "new"}:${operation || "latest"}`}
        initialProject={project || null}
        initialOperation={operation || null}
      />
    </div>
  );
}
