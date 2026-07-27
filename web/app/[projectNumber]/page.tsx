import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectNumber: string }>;
}): Promise<Metadata> {
  const { projectNumber } = await params;
  return {
    title: { absolute: `프로젝트 /${projectNumber} | 이지컷` },
    robots: { index: false, follow: false },
  };
}

export default async function ProjectNumberPage({
  params,
}: {
  params: Promise<{ projectNumber: string }>;
}) {
  const { projectNumber: rawProjectNumber } = await params;
  if (!/^[1-9]\d*$/.test(rawProjectNumber)) notFound();

  const projectNumber = Number(rawProjectNumber);
  if (!Number.isSafeInteger(projectNumber)) notFound();

  permanentRedirect(`/projects/${projectNumber}`);
}
