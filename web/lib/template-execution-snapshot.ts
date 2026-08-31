import type { TransactionSql } from "postgres";
import type {
  TemplateId,
  VideoAspectRatio,
} from "@/lib/contracts";
import { templateSnapshotFromRow } from "@/lib/custom-templates";
import { HttpError } from "@/lib/http";
import { lockTemplateDesignForSave } from "@/lib/custom-template-design";
import {
  CUSTOM_TEMPLATE_VERSION_CONFLICT,
  templateHasCustomDesign,
  templateVersionRequiresConfirmation,
} from "@/lib/template-design";
import {
  lockEffectiveSubtitleTemplateAccess,
  type SubtitleTemplateAccess,
} from "@/lib/subtitle-template-release";
import {
  STABLE_SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
  subtitleTemplateStyleSnapshot,
} from "@/lib/subtitle-templates";
import {
  isTemplateConfigV5,
  type TemplateConfigV5,
  type TemplatePresetColor,
} from "@/lib/template-config";

export const UNIFIED_TEMPLATE_SUBTITLE_CANARY_REQUIRED =
  "UNIFIED_TEMPLATE_SUBTITLE_CANARY_REQUIRED" as const;

export function assertUnifiedTemplateSubtitleCanaryAccess(
  access: Pick<SubtitleTemplateAccess, "unifiedEnabled">,
) {
  if (!access.unifiedEnabled) {
    throw new HttpError(
      403,
      "현재 계정에서는 자막 포함 커스텀 템플릿을 사용할 수 없습니다.",
      UNIFIED_TEMPLATE_SUBTITLE_CANARY_REQUIRED,
    );
  }
}

export function unifiedSubtitleSnapshotFromTemplateConfig(
  config: TemplateConfigV5,
) {
  const subtitle = config.subtitle;
  const base = subtitleTemplateStyleSnapshot(
    subtitle.variant,
    config.video.aspectRatio,
    subtitle.accentColor,
    "lower",
    subtitle.fontId,
    STABLE_SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
  );
  const captionHeight = Math.max(140, subtitle.fontSize + 32);
  const safeArea = {
    x: Math.round(subtitle.x - subtitle.maxWidth / 2),
    y: Math.round(subtitle.y - captionHeight / 2),
    width: subtitle.maxWidth,
    height: captionHeight,
  };
  return {
    ...base,
    schemaVersion: 4 as const,
    origin: "unified-template-v5" as const,
    enabled: subtitle.visible,
    font: {
      ...base.font,
      sizePx: subtitle.fontSize,
      minSizePx: Math.min(
        subtitle.fontSize,
        subtitle.variant === "pop" ? 64 : 72,
      ),
    },
    color: {
      ...base.color,
      text: subtitle.color,
      active: subtitle.accentColor,
    },
    maxWidthPx: subtitle.maxWidth,
    layout: {
      ...base.layout,
      caption: safeArea,
    },
    safeArea,
  };
}

export function isUnifiedTemplateSubtitleSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const snapshot = value as Record<string, unknown>;
  return snapshot.schemaVersion === 4
    && snapshot.origin === "unified-template-v5";
}

type ResolveAccess = (
  db: TransactionSql,
  userId: string | null,
) => Promise<SubtitleTemplateAccess>;

export type ResolvedTemplateExecutionSnapshot = {
  resolvedTemplateId: TemplateId;
  resolvedVideoAspectRatio: VideoAspectRatio;
  templateSnapshot:
    | ReturnType<typeof templateSnapshotFromRow>
    | { presetVersion: 3; brandColor?: TemplatePresetColor };
  subtitleTemplateSnapshot:
    | ReturnType<typeof unifiedSubtitleSnapshotFromTemplateConfig>
    | null;
  usesUnifiedTemplateSubtitleCanary: boolean;
  usesCustomTemplateDesign?: boolean;
};

export async function resolveTemplateExecutionSnapshot(
  db: TransactionSql,
  input: {
    userId: string | null;
    templateId: TemplateId;
    customTemplateId?: string | null;
    customTemplateVersion?: number | null;
    videoAspectRatio: VideoAspectRatio;
    brandColor?: TemplatePresetColor;
  },
  resolveAccess: ResolveAccess = lockEffectiveSubtitleTemplateAccess,
): Promise<ResolvedTemplateExecutionSnapshot> {
  if (!input.customTemplateId) {
    return {
      resolvedTemplateId: input.templateId,
      resolvedVideoAspectRatio: input.videoAspectRatio,
      templateSnapshot: {
        presetVersion: 3,
        ...(input.brandColor ? { brandColor: input.brandColor } : {}),
      },
      subtitleTemplateSnapshot: null,
      usesUnifiedTemplateSubtitleCanary: false,
    };
  }
  if (input.brandColor) {
    throw new HttpError(
      400,
      "내 템플릿에는 브랜드 컬러를 별도로 적용할 수 없습니다.",
    );
  }
  const rows = await db`
    select id, name, base_template_id, config, version
    from shorts_mvp.custom_templates
    where id=${input.customTemplateId} and user_id=${input.userId}
    limit 1 for share
  `;
  if (!rows[0]) {
    throw new HttpError(404, "선택한 개인 템플릿을 찾을 수 없습니다.");
  }
  const templateSnapshot = templateSnapshotFromRow(rows[0]);
  if (templateVersionRequiresConfirmation(
    templateSnapshot.config,
    templateSnapshot.version,
    input.customTemplateVersion,
  )) {
    throw new HttpError(
      409,
      "템플릿이 변경되었습니다. 최신 미리보기를 확인한 후 다시 만들어 주세요.",
      CUSTOM_TEMPLATE_VERSION_CONFLICT,
    );
  }
  const usesCustomTemplateDesign = templateHasCustomDesign(templateSnapshot.config);
  if (usesCustomTemplateDesign) {
    await lockTemplateDesignForSave(db, input.userId, templateSnapshot.config);
  }
  let subtitleTemplateSnapshot: ReturnType<
    typeof unifiedSubtitleSnapshotFromTemplateConfig
  > | null = null;
  if (isTemplateConfigV5(templateSnapshot.config)) {
    assertUnifiedTemplateSubtitleCanaryAccess(
      await resolveAccess(db, input.userId),
    );
    subtitleTemplateSnapshot = unifiedSubtitleSnapshotFromTemplateConfig(
      templateSnapshot.config,
    );
  }
  return {
    resolvedTemplateId: templateSnapshot.baseTemplateId,
    resolvedVideoAspectRatio: templateSnapshot.config.video.aspectRatio,
    templateSnapshot,
    subtitleTemplateSnapshot,
    usesUnifiedTemplateSubtitleCanary: subtitleTemplateSnapshot !== null,
    ...(usesCustomTemplateDesign ? { usesCustomTemplateDesign: true } : {}),
  };
}
