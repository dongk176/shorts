import { notFound, redirect } from "next/navigation";
import { TemplateEditor } from "../template-editor";
import {
  createDefaultTemplateConfig,
  createUnifiedSubtitleTemplateConfig,
  upgradeTemplateConfigToV5,
  type UnifiedSubtitleVariant,
} from "@/lib/template-config";
import { templateIds, type TemplateId } from "@/lib/contracts";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { getDb } from "@/lib/db";
import { requireMvpSession } from "@/lib/session";
import { getSubtitleTemplateAccess } from "@/lib/subtitle-template-release";

const subtitlePresetVariants: Record<string, UnifiedSubtitleVariant> = {
  "subtitle-pop": "pop",
  "subtitle-highlight": "highlight",
};

export default async function NewTemplatePage({ searchParams }: { searchParams: Promise<{ base?: string; preset?: string }> }) {
  const user = await getAuthenticatedUser();
  const { base, preset } = await searchParams;
  const baseTemplateId = (templateIds.includes(base as TemplateId) ? base : "dark-minimal") as TemplateId;
  const next = `/templates/new${preset ? `?preset=${encodeURIComponent(preset)}` : base ? `?base=${encodeURIComponent(base)}` : ""}`;
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  const session = await requireMvpSession(user, { createIfMissing: false });
  const subtitleAccess = await getSubtitleTemplateAccess(getDb(), session.userId);
  const unifiedSubtitleCanaryEnabled = subtitleAccess.unifiedEnabled;
  const subtitleVariant = preset ? subtitlePresetVariants[preset] : null;
  if (preset && (!subtitleVariant || !unifiedSubtitleCanaryEnabled)) notFound();

  const initialConfig = subtitleVariant
    ? createUnifiedSubtitleTemplateConfig(subtitleVariant)
    : unifiedSubtitleCanaryEnabled
      ? upgradeTemplateConfigToV5(createDefaultTemplateConfig(baseTemplateId))
      : createDefaultTemplateConfig(baseTemplateId);
  const suggestedName = subtitleVariant === "pop"
    ? "자막 팝형 템플릿"
    : subtitleVariant === "highlight"
      ? "자막 강조형 템플릿"
      : undefined;
  return <TemplateEditor
    initialTemplate={null}
    baseTemplateId={subtitleVariant ? "dark-minimal" : baseTemplateId}
    initialConfig={initialConfig}
    unifiedSubtitleCanaryEnabled={unifiedSubtitleCanaryEnabled}
    suggestedName={suggestedName}
  />;
}
