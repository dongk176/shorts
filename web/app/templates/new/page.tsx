import { redirect } from "next/navigation";
import { TemplateEditor } from "../template-editor";
import { createDefaultTemplateConfig } from "@/lib/template-config";
import { templateIds, type TemplateId } from "@/lib/contracts";
import { getAuthenticatedUser } from "@/lib/supabase/server";

export default async function NewTemplatePage({ searchParams }: { searchParams: Promise<{ base?: string }> }) {
  const user = await getAuthenticatedUser();
  const { base } = await searchParams;
  const baseTemplateId = (templateIds.includes(base as TemplateId) ? base : "dark-minimal") as TemplateId;
  const next = `/templates/new${base ? `?base=${encodeURIComponent(base)}` : ""}`;
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  return <TemplateEditor initialTemplate={null} baseTemplateId={baseTemplateId} initialConfig={createDefaultTemplateConfig(baseTemplateId)} />;
}
