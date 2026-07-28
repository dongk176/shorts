import type { TemplateId } from "@/lib/contracts";

export const CURRENT_PRESET_TEMPLATE_SNAPSHOT = Object.freeze({
  presetVersion: 3,
});

type ExistingTemplateSelection = {
  templateId: TemplateId;
  customTemplateId: string | null;
  templateSnapshot: Record<string, unknown> | null;
};

type ResolveEditedTemplateSelectionInput = {
  existing: ExistingTemplateSelection;
  requestedTemplateId: TemplateId;
  requestedCustomTemplateId?: string | null;
};

export type EditedTemplateSelection = {
  customTemplateId: string | null;
  templateSnapshot: Record<string, unknown> | null;
};

export function resolveEditedTemplateSelection({
  existing,
  requestedTemplateId,
  requestedCustomTemplateId,
}: ResolveEditedTemplateSelectionInput): EditedTemplateSelection | null {
  if (requestedCustomTemplateId !== undefined && requestedCustomTemplateId !== null) {
    if (
      requestedCustomTemplateId !== existing.customTemplateId
      || requestedTemplateId !== existing.templateId
    ) {
      return null;
    }
    return {
      customTemplateId: existing.customTemplateId,
      templateSnapshot: existing.templateSnapshot,
    };
  }

  if (requestedCustomTemplateId === null) {
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
