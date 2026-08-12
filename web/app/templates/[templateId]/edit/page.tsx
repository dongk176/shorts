import { notFound, redirect } from "next/navigation";
import { customTemplateFromRow } from "@/lib/custom-templates";
import { getDb } from "@/lib/db";
import { requireMvpSession } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { TemplateEditor } from "../../template-editor";

export default async function EditTemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const user = await getAuthenticatedUser();
  const next = `/templates/${templateId}/edit`;
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  const session = await requireMvpSession(user, { createIfMissing: false });
  const db = getDb();
  const rows = await db`
    select id, name, base_template_id, config, version, created_at, updated_at
    from shorts_mvp.custom_templates where id=${templateId} and user_id=${session.userId} limit 1
  `;
  if (!rows[0]) notFound();
  const template = customTemplateFromRow(rows[0]);
  return <TemplateEditor initialTemplate={template} baseTemplateId={template.baseTemplateId} initialConfig={template.config} />;
}
