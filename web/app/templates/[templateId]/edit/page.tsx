import { notFound, redirect } from "next/navigation";
import { customTemplateFromRow } from "@/lib/custom-templates";
import { getDb } from "@/lib/db";
import { requireMvpSession } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import {
  getPublicSubtitleTemplateAccess,
  getSubtitleTemplateAccess,
} from "@/lib/subtitle-template-release";
import {
  isTemplateConfigV5,
  upgradeTemplateConfigToV5,
} from "@/lib/template-config";
import { TemplateEditor } from "../../template-editor";

export default async function EditTemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const user = await getAuthenticatedUser();
  const next = `/templates/${templateId}/edit`;
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  const session = await requireMvpSession(user, { createIfMissing: false });
  const db = getDb();
  const [rows, subtitleAccess] = await Promise.all([
    db`
      select id, name, base_template_id, config, version, created_at, updated_at
      from shorts_mvp.custom_templates where id=${templateId} and user_id=${session.userId} limit 1
    `,
    session.isAdmin === true
      ? getSubtitleTemplateAccess(db, session.userId)
      : getPublicSubtitleTemplateAccess(db, session.userId),
  ]);
  if (!rows[0]) notFound();
  const template = customTemplateFromRow(rows[0]);
  if (isTemplateConfigV5(template.config) && !subtitleAccess.unifiedEnabled) notFound();
  const initialConfig = subtitleAccess.unifiedEnabled
    ? upgradeTemplateConfigToV5(template.config)
    : template.config;
  return <TemplateEditor
    initialTemplate={template}
    baseTemplateId={template.baseTemplateId}
    initialConfig={initialConfig}
    unifiedSubtitleCanaryEnabled={subtitleAccess.unifiedEnabled}
  />;
}
