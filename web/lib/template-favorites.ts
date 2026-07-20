import { z } from "zod";
import { templateIds, type TemplateId } from "@/lib/contracts";

export const MAX_FAVORITE_TEMPLATES = 4;

const presetTemplateIds = new Set<string>(templateIds);
const customTemplateIdSchema = z.string().uuid();

export function presetTemplateFavoriteKey(templateId: TemplateId) {
  return `preset:${templateId}`;
}

export function customTemplateFavoriteKey(templateId: string) {
  return `custom:${templateId}`;
}

export const DEFAULT_FAVORITE_TEMPLATE_KEYS = [
  presetTemplateFavoriteKey("comment-capture"),
  presetTemplateFavoriteKey("dark-minimal"),
  presetTemplateFavoriteKey("paper"),
] as const;

export const templateFavoriteKeySchema = z.string().max(80).refine((value) => {
  if (value.startsWith("preset:")) return presetTemplateIds.has(value.slice("preset:".length));
  if (value.startsWith("custom:")) return customTemplateIdSchema.safeParse(value.slice("custom:".length)).success;
  return false;
}, "올바른 템플릿 저장 키가 아닙니다.");

export const templateFavoriteKeysSchema = z.array(templateFavoriteKeySchema)
  .max(MAX_FAVORITE_TEMPLATES, `자주 쓰는 템플릿은 최대 ${MAX_FAVORITE_TEMPLATES}개까지 등록할 수 있습니다.`)
  .refine((keys) => new Set(keys).size === keys.length, "같은 템플릿을 중복 등록할 수 없습니다.");

export type TemplateFavoriteKey = z.infer<typeof templateFavoriteKeySchema>;

export function resolveStoredFavoriteTemplateKeys(value: unknown): TemplateFavoriteKey[] {
  const parsed = templateFavoriteKeysSchema.safeParse(value);
  return parsed.success ? parsed.data : [...DEFAULT_FAVORITE_TEMPLATE_KEYS];
}

export function favoritePresetTemplateId(key: string): TemplateId | null {
  if (!key.startsWith("preset:")) return null;
  const templateId = key.slice("preset:".length);
  return presetTemplateIds.has(templateId) ? templateId as TemplateId : null;
}

export function favoriteCustomTemplateId(key: string): string | null {
  if (!key.startsWith("custom:")) return null;
  const templateId = key.slice("custom:".length);
  return customTemplateIdSchema.safeParse(templateId).success ? templateId : null;
}

export type FavoriteTemplateUpdate =
  | { status: "added" | "removed"; templateKeys: TemplateFavoriteKey[] }
  | { status: "limit"; templateKeys: TemplateFavoriteKey[] };

export function updateFavoriteTemplateKeys(
  currentKeys: readonly TemplateFavoriteKey[],
  templateKey: TemplateFavoriteKey,
): FavoriteTemplateUpdate {
  if (currentKeys.includes(templateKey)) {
    return {
      status: "removed",
      templateKeys: currentKeys.filter((key) => key !== templateKey),
    };
  }
  if (currentKeys.length >= MAX_FAVORITE_TEMPLATES) {
    return { status: "limit", templateKeys: [...currentKeys] };
  }
  return { status: "added", templateKeys: [...currentKeys, templateKey] };
}
