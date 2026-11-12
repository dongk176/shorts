import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseCaptionRenderSpec } from "@/lib/caption-render-spec";
import { getDb } from "@/lib/db";
import { getCustomTemplateDesignAccess } from "@/lib/custom-template-design-access";
import { editorOverlayPreviewEnabled } from "@/lib/editor-overlay-preview-flag";
import {
  subtitleEditingReleaseEnabled,
  editorRenderingV2MasterEnabled,
  type EditorReleaseAssignment,
} from "@/lib/editor-rendering-release";
import { rangeEditingEnabled } from "@/lib/range-editing";
import { requireMvpSession } from "@/lib/session";
import { resolveUnifiedTemplateSubtitleEditorContext } from "@/lib/subtitle-template-release";
import { isUnifiedTemplateSubtitleSnapshot } from "@/lib/template-execution-snapshot";
import { ShortEditorPage } from "../../../../shorts-app";
import { MidformEditorPage } from "@/components/midform-editor-page";
import { midformCloudEnabled } from "@/lib/midform-cloud";
import { requireMidformAdmin } from "@/lib/midform-release";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "쇼츠 편집 | 이지컷" },
  robots: { index: false, follow: false },
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditShortPage({ params, searchParams }: { params: Promise<{ projectNumber: string; shortId: string }>; searchParams: Promise<{ format?: string }> }) {
  const { projectNumber: rawProjectNumber, shortId } = await params;
  if (!/^[1-9]\d*$/.test(rawProjectNumber) || !uuidPattern.test(shortId)) notFound();
  const projectNumber = Number(rawProjectNumber);
  if (!Number.isSafeInteger(projectNumber)) notFound();
  const db = getDb();
  if ((await searchParams).format === "midform") {
    if (!midformCloudEnabled()) notFound();
    const session = await requireMvpSession(undefined, { createIfMissing: false, readOnly: true });
    if (session.isAdmin !== true) notFound();
    await requireMidformAdmin(db, session.userId);
    const [owned] = await db`select s.id from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId} and s.user_id=${session.userId} and j.user_id=${session.userId}
        and j.project_number=${projectNumber} and j.midform_request is not null
        and s.midform_document is not null and s.status in ('ready','rerendering')
        and s.deleted_at is null and j.user_deleted_at is null and s.expires_at > now()`;
    if (!owned) notFound();
    return <MidformEditorPage projectNumber={projectNumber} shortId={shortId} />;
  }
  const localOverlayPreviewEnabled = editorOverlayPreviewEnabled();
  let editorRelease: EditorReleaseAssignment = {
    channel: "legacy",
    releaseId: null,
    uiVersion: null,
    documentVersion: null,
    subtitleEditingCapable: false,
    subtitleEditingPublicEnabled: false,
  };
  let unifiedTemplateSubtitleCanaryEnabled = false;
  let customTemplateDesignEnabled = false;
  if (editorRenderingV2MasterEnabled()) {
    const session = await requireMvpSession(undefined, { createIfMissing: false });
    const {
      editorRelease: resolvedEditorRelease,
      subtitleAccess,
    } = await resolveUnifiedTemplateSubtitleEditorContext(db, session.userId, shortId);
    editorRelease = resolvedEditorRelease;
    unifiedTemplateSubtitleCanaryEnabled = subtitleAccess.unifiedEnabled;
    customTemplateDesignEnabled = (await getCustomTemplateDesignAccess(db, session.userId)).enabled;
  }
  const adminSubtitleLayoutEnabled = subtitleEditingReleaseEnabled(
    editorRelease,
  );
  const subtitleTemplateShortRows = await db`
    select s.id,s.subtitle_template_id,s.subtitle_template_snapshot,
      s.caption_render_spec,s.subtitles_enabled
    from shorts_mvp.generated_shorts s
    join shorts_mvp.video_jobs j on j.id=s.job_id
    where s.id=${shortId}
      and j.project_number=${projectNumber}
    limit 1
  `;
  const subtitleTemplateShort = subtitleTemplateShortRows[0];
  const storedCaptionRenderSpec = parseCaptionRenderSpec(
    subtitleTemplateShort?.captionRenderSpec,
  );
  const unifiedTemplateSubtitleOutput = isUnifiedTemplateSubtitleSnapshot(
    subtitleTemplateShort?.subtitleTemplateSnapshot,
  );
  if (
    subtitleTemplateShort?.subtitleTemplateId
    && (
      !adminSubtitleLayoutEnabled
      || (!storedCaptionRenderSpec && subtitleTemplateShort.subtitlesEnabled !== false)
    )
  ) notFound();
  if (
    unifiedTemplateSubtitleOutput
    && !unifiedTemplateSubtitleCanaryEnabled
  ) notFound();
  const editorSaveEnabled = editorRelease.channel !== "legacy";
  return <ShortEditorPage
    projectNumber={projectNumber}
    shortId={shortId}
    rangeEditingEnabled={rangeEditingEnabled()}
    overlayPreviewEnabled={localOverlayPreviewEnabled || editorSaveEnabled}
    editorSaveEnabled={editorSaveEnabled}
    editorRelease={editorRelease}
    unifiedTemplateSubtitleCanaryEnabled={unifiedTemplateSubtitleCanaryEnabled}
    customTemplateDesignEnabled={customTemplateDesignEnabled}
  />;
}
