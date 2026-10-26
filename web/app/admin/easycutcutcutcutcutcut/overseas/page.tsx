import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireOverseasAdminUser } from "@/lib/admin-overseas-auth";
import { loadAdminOverseas } from "@/lib/admin-overseas";
import { overseasPath } from "@/lib/admin-overseas-contract";
import { ensureAdminDbReady } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createNoIndexMetadata } from "@/lib/seo";
import { OverseasDashboard } from "./overseas-dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = createNoIndexMetadata("해외 전용 관리자", "Easy Cut 해외 운영 전용 화면입니다.");

export default async function OverseasAdminPage({searchParams}: {searchParams: Promise<Record<string,string|string[]|undefined>>}) {
  await ensureAdminDbReady();
  try { await requireOverseasAdminUser(); }
  catch(error) {
    if (error instanceof HttpError && error.status===401) redirect(`${overseasPath}/login`);
    notFound();
  }
  const data = await loadAdminOverseas(await searchParams);
  return <OverseasDashboard data={data} />;
}
