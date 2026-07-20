import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShortEditorPage } from "../../../shorts-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "쇼츠 편집 | 이지컷" },
  robots: { index: false, follow: false },
};

export default async function EditShortPage({ params }: { params: Promise<{ projectNumber: string; shortId: string }> }) {
  const { projectNumber: rawProjectNumber, shortId } = await params;
  if (!/^[1-9]\d*$/.test(rawProjectNumber) || !shortId) notFound();
  const projectNumber = Number(rawProjectNumber);
  if (!Number.isSafeInteger(projectNumber)) notFound();
  return <ShortEditorPage projectNumber={projectNumber} shortId={shortId} />;
}
