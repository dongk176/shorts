import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { editorOverlayPreviewEnabled } from "@/lib/editor-overlay-preview-flag";
import {
  editorRenderingV2Enabled,
  editorRenderingV2MasterEnabled,
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
  let editorSaveEnabled = false;
  if (editorRenderingV2MasterEnabled()) {
    const session = await requireMvpSession();
    editorSaveEnabled = await editorRenderingV2Enabled(
      getDb(),
      session.userId,
    );
  }
  return <ShortEditorPage
    projectNumber={projectNumber}
    shortId={shortId}
    rangeEditingEnabled={rangeEditingEnabled()}
    overlayPreviewEnabled={localOverlayPreviewEnabled || editorSaveEnabled}
    editorSaveEnabled={editorSaveEnabled}
  />;
}
