import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { editorOverlayPreviewEnabled } from "@/lib/editor-overlay-preview-flag";
import {
  adminSubtitleLayoutReleaseEnabled,
  editorRenderingV2MasterEnabled,
  resolveEditorRelease,
  type EditorReleaseAssignment,
} from "@/lib/editor-rendering-release";
import { rangeEditingEnabled } from "@/lib/range-editing";
import { requireMvpSession } from "@/lib/session";
import { ShortEditorPage } from "../../../../shorts-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "쇼츠 편집 | 이지컷" },
  robots: { index: false, follow: false },
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditShortPage({ params }: { params: Promise<{ projectNumber: string; shortId: string }> }) {
  const { projectNumber: rawProjectNumber, shortId } = await params;
  if (!/^[1-9]\d*$/.test(rawProjectNumber) || !uuidPattern.test(shortId)) notFound();
  const projectNumber = Number(rawProjectNumber);
  if (!Number.isSafeInteger(projectNumber)) notFound();
  const db = getDb();
  const localOverlayPreviewEnabled = editorOverlayPreviewEnabled();
  let editorRelease: EditorReleaseAssignment = {
    channel: "legacy",
    releaseId: null,
    uiVersion: null,
    documentVersion: null,
  };
  if (editorRenderingV2MasterEnabled()) {
    const session = await requireMvpSession();
    editorRelease = await resolveEditorRelease(
      db,
      session.userId,
    );
  }
  const adminSubtitleLayoutEnabled = adminSubtitleLayoutReleaseEnabled(
    editorRelease,
  );
  const subtitleTemplateShortRows = await db`
    select s.id
    from shorts_mvp.generated_shorts s
    join shorts_mvp.video_jobs j on j.id=s.job_id
    where s.id=${shortId}
      and j.project_number=${projectNumber}
      and s.subtitle_template_id is not null
    limit 1
  `;
  if (subtitleTemplateShortRows[0] && !adminSubtitleLayoutEnabled) notFound();
  const editorSaveEnabled = editorRelease.channel !== "legacy";
  return <ShortEditorPage
    projectNumber={projectNumber}
    shortId={shortId}
    rangeEditingEnabled={rangeEditingEnabled()}
    overlayPreviewEnabled={localOverlayPreviewEnabled || editorSaveEnabled}
    editorSaveEnabled={editorSaveEnabled}
    editorRelease={editorRelease}
  />;
}
