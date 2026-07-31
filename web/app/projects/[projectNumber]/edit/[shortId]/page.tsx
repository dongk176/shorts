import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { editorOverlayPreviewEnabled } from "@/lib/editor-overlay-preview-flag";
import {
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

export default async function EditShortPage({ params }: { params: Promise<{ projectNumber: string; shortId: string }> }) {
  const { projectNumber: rawProjectNumber, shortId } = await params;
  if (!/^[1-9]\d*$/.test(rawProjectNumber) || !shortId) notFound();
  const projectNumber = Number(rawProjectNumber);
  if (!Number.isSafeInteger(projectNumber)) notFound();
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
      getDb(),
      session.userId,
    );
  }
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
