import type { TemplateId } from "@/lib/contracts";

const adminPresetTemplateNames: Partial<Record<TemplateId, string>> = {
  "dark-red": "다크",
  "white-yellow": "화이트",
};

const adminPresetTemplateDescriptions: Partial<Record<TemplateId, string>> = {
  "dark-red": "어두운 배경과 선택한 브랜드 컬러로 핵심을 각인하는 구성",
  "white-yellow": "밝은 배경과 선택한 브랜드 컬러로 내용을 전달하는 구성",
};

export function presetTemplateDisplayName(
  templateId: TemplateId,
  fallback: string,
  adminCandidateEnabled: boolean,
) {
  return adminCandidateEnabled
    ? adminPresetTemplateNames[templateId] || fallback
    : fallback;
}

export function presetTemplateDisplayDescription(
  templateId: TemplateId,
  fallback: string,
  adminCandidateEnabled: boolean,
) {
  return adminCandidateEnabled
    ? adminPresetTemplateDescriptions[templateId] || fallback
    : fallback;
}
