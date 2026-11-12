import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ProjectLoginRequiredPage } from "@/components/project-login-gate";
import { getAuthenticatedProjectPageAccess } from "@/lib/data";
import { getDb } from "@/lib/db";
import {
  subtitleEditingReleaseEnabled,
  editorRenderingV2MasterEnabled,
} from "@/lib/editor-rendering-release";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { midformCloudEnabled } from "@/lib/midform-cloud";
import { resolveUnifiedTemplateSubtitleEditorContext } from "@/lib/subtitle-template-release";
import { ProjectPage } from "../../shorts-app";
import { canUseYoutubePublishing, youtubeReviewerShortForProject } from "@/lib/youtube-accounts/review-access";
import { canUseAdminPublishing, metaReviewerShortForProject } from "@/lib/social-publishing/access";

import { canUseInstagramPublishing } from "@/lib/social-publishing/meta/access";
import { canUseTikTokPublishing } from "@/lib/social-publishing/tiktok/access";

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
  if (midformCloudEnabled()) {
    const [midform] = await db`select s.id from shorts_mvp.video_jobs j
      join shorts_mvp.generated_shorts s on s.job_id=j.id
      join shorts_mvp.app_users u on u.id=j.user_id
      where u.auth_user_id=${user.id} and u.is_admin=true
        and j.project_number=${projectNumber} and s.user_id=u.id
        and j.midform_request is not null and s.midform_document is not null
        and s.status in ('ready','rerendering') and j.user_deleted_at is null
        and s.deleted_at is null and s.expires_at > now() limit 1`;
    if (midform) redirect(`/projects/${projectNumber}/edit/${midform.id}?format=midform`);
  }
  const projectAccess = await getAuthenticatedProjectPageAccess(
    db,
    user.id,
    projectNumber,
  );
  if (!projectAccess?.canAccess) notFound();

  let adminSubtitleLayoutEnabled = false;
  let unifiedTemplateSubtitleCanaryEnabled = false;
  if (editorRenderingV2MasterEnabled()) {
    const { editorRelease, subtitleAccess } = await resolveUnifiedTemplateSubtitleEditorContext(
      db,
      projectAccess.appUserId,
    );
    adminSubtitleLayoutEnabled = subtitleEditingReleaseEnabled(editorRelease);
    unifiedTemplateSubtitleCanaryEnabled = subtitleAccess.unifiedEnabled
      && adminSubtitleLayoutEnabled;
  }

  const [adminPublishingEnabled, metaReviewerShortId, youtubeReviewerShortId, youtubePublishingEnabled, tiktokPublishingEnabled, instagramPublishingEnabled] = await Promise.all([
    canUseAdminPublishing(db, projectAccess.appUserId),
    metaReviewerShortForProject(db, projectAccess.appUserId, projectNumber),
    youtubeReviewerShortForProject(db, projectAccess.appUserId, projectNumber),
    canUseYoutubePublishing(db, projectAccess.appUserId),
    canUseTikTokPublishing(db, projectAccess.appUserId),
    canUseInstagramPublishing(db, projectAccess.appUserId),
  ]);

  return <ProjectPage
    projectNumber={projectNumber}
    adminPublishingEnabled={adminPublishingEnabled}
    tiktokPublishingEnabled={tiktokPublishingEnabled}
    instagramPublishingEnabled={instagramPublishingEnabled}
    metaReviewerShortId={metaReviewerShortId}
    youtubeReviewerShortId={youtubeReviewerShortId}
    youtubePublishingEnabled={youtubePublishingEnabled}
    adminSubtitleLayoutEnabled={adminSubtitleLayoutEnabled}
    unifiedTemplateSubtitleCanaryEnabled={unifiedTemplateSubtitleCanaryEnabled}
  />;
}
