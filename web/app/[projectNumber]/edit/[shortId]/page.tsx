import { notFound, permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EditShortPage({ params }: { params: Promise<{ projectNumber: string; shortId: string }> }) {
  const { projectNumber: rawProjectNumber, shortId } = await params;
  if (!/^[1-9]\d*$/.test(rawProjectNumber) || !shortId) notFound();
  const projectNumber = Number(rawProjectNumber);
  if (!Number.isSafeInteger(projectNumber)) notFound();
  permanentRedirect(`/projects/${projectNumber}/edit/${encodeURIComponent(shortId)}`);
}
