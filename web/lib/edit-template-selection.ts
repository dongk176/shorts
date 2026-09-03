import type { TemplateId } from "@/lib/contracts";

type JsonValue =
  | null
  | string
  | number
  | boolean
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined };

type JsonObject = { readonly [key: string]: JsonValue | undefined };

export const CURRENT_PRESET_TEMPLATE_SNAPSHOT = Object.freeze({
  presetVersion: 3,
});

type ExistingTemplateSelection = {
  templateId: TemplateId;
  customTemplateId: string | null;
  templateSnapshot: JsonObject | null;
};

type ResolveEditedTemplateSelectionInput = {
  existing: ExistingTemplateSelection;
  requestedTemplateId: TemplateId;
  requestedCustomTemplateId?: string | null;
  templateSelectionTouched?: boolean;
};

export type EditedTemplateSelection = {
  customTemplateId: string | null;
  templateSnapshot: JsonObject | null;
};

export function resolveEditedTemplateSelection({
  existing,
  requestedTemplateId,
  requestedCustomTemplateId,
  templateSelectionTouched,
}: ResolveEditedTemplateSelectionInput): EditedTemplateSelection | null {
  const effectiveRequestedCustomTemplateId = templateSelectionTouched === false
    ? undefined
    : requestedCustomTemplateId;
  if (
    effectiveRequestedCustomTemplateId !== undefined
    && effectiveRequestedCustomTemplateId !== null
  ) {
    if (
      effectiveRequestedCustomTemplateId !== existing.customTemplateId
      || requestedTemplateId !== existing.templateId
    ) {
      return null;
    }
    return {
      customTemplateId: existing.customTemplateId,
      templateSnapshot: existing.templateSnapshot,
    };
  }

  if (effectiveRequestedCustomTemplateId === null) {
    return {
      customTemplateId: null,
      templateSnapshot: CURRENT_PRESET_TEMPLATE_SNAPSHOT,
    };
  }

  if (requestedTemplateId === existing.templateId) {
    return {
      customTemplateId: existing.customTemplateId,
      templateSnapshot: existing.templateSnapshot,
    };
  }

  return {
    customTemplateId: null,
    templateSnapshot: CURRENT_PRESET_TEMPLATE_SNAPSHOT,
  };
}
