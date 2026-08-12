import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectLoginRequiredPage } from "@/components/project-login-gate";
import { getAuthenticatedProjectPageAccess } from "@/lib/data";
import { getDb } from "@/lib/db";
import {
  subtitleEditingReleaseEnabled,
  editorRenderingV2MasterEnabled,
  resolveEditorRelease,
} from "@/lib/editor-rendering-release";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { ProjectPage } from "../../shorts-app";

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

  const user = await getAuthenticatedUser();
  if (!user) {
    return <ProjectLoginRequiredPage projectNumber={projectNumber} />;
  }

  const db = getDb();
  const projectAccess = await getAuthenticatedProjectPageAccess(
    db,
    user.id,
    projectNumber,
  );
  if (!projectAccess?.canAccess) notFound();

  let adminSubtitleLayoutEnabled = false;
  if (editorRenderingV2MasterEnabled()) {
    const editorRelease = await resolveEditorRelease(
      db,
      projectAccess.appUserId,
    );
    adminSubtitleLayoutEnabled = subtitleEditingReleaseEnabled(
      editorRelease,
    );
  }

  return <ProjectPage
    projectNumber={projectNumber}
    adminSubtitleLayoutEnabled={adminSubtitleLayoutEnabled}
  />;
}
