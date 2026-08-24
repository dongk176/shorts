import { z } from "zod";
import { templateIds, videoAspectRatios, type TemplateId, type VideoAspectRatio } from "@/lib/contracts";
import { DEFAULT_EDITOR_FONT_ID, editorFontIds } from "@/lib/editor-fonts";

export const TEMPLATE_CANVAS = { width: 1080, height: 1920 } as const;
export const MAX_PERSONAL_TEMPLATES = 50;
export const COMMENT_BACKGROUND_COLOR = "#040404" as const;
export const COMMENT_CAPTURE_LANDSCAPE_LIFT_PX = 160;
export const PRESET_SQUARE_CHANNEL_CENTER_Y = 1580;
export const COMMENT_CAPTURE_SQUARE_CHANNEL_CENTER_Y = 1840;

export const stockBackgrounds = [
  { id: "news-blue-geometric", label: "뉴스 블루", src: "/template-backgrounds/news-blue-geometric.png" },
  { id: "news-blue-diagonal", label: "뉴스 대각선", src: "/template-backgrounds/news-blue-diagonal.png" },
  { id: "news-red-globe", label: "뉴스 레드", src: "/template-backgrounds/news-red-globe.png" },
  { id: "trust-network", label: "신뢰 네트워크", src: "/template-backgrounds/trust-network.png" },
  { id: "trust-circuit", label: "신뢰 서킷", src: "/template-backgrounds/trust-circuit.png" },
  { id: "white-vinyl", label: "화이트 비닐", src: "/template-backgrounds/white-vinyl.png" },
  { id: "white-grid", label: "화이트 격자", src: "/template-backgrounds/white-grid.png" },
  { id: "white-hanji", label: "화이트 한지", src: "/template-backgrounds/white-hanji.png" },
] as const;

export type StockBackgroundId = (typeof stockBackgrounds)[number]["id"];
export const stockBackgroundIds = stockBackgrounds.map((item) => item.id) as [StockBackgroundId, ...StockBackgroundId[]];

export const templatePresetColors = [
  COMMENT_BACKGROUND_COLOR, "#000000", "#111111", "#1B1B1E", "#353438", "#64748B", "#FFFFFF", "#F3F0E9",
  "#E32626", "#FF4D4F", "#FF715E", "#FFB4A8", "#F97316", "#FFD84D", "#8BFF5A",
  "#16A34A", "#35E6E3", "#3B82F6", "#2563EB", "#A78BFA", "#DB2777",
] as const;

export type TemplatePresetColor = (typeof templatePresetColors)[number];

export const templatePresetColorNames: Record<TemplatePresetColor, string> = {
  [COMMENT_BACKGROUND_COLOR]: "댓글 배경",
  "#000000": "블랙",
  "#111111": "딥 차콜",
  "#1B1B1E": "차콜",
  "#353438": "웜 그레이",
  "#64748B": "슬레이트",
  "#FFFFFF": "화이트",
  "#F3F0E9": "아이보리",
  "#E32626": "딥 레드",
  "#FF4D4F": "레드",
  "#FF715E": "코랄",
  "#FFB4A8": "소프트 코랄",
  "#F97316": "오렌지",
  "#FFD84D": "옐로",
  "#8BFF5A": "라임",
  "#16A34A": "그린",
  "#35E6E3": "아쿠아",
  "#3B82F6": "블루",
  "#2563EB": "딥 블루",
  "#A78BFA": "퍼플",
  "#DB2777": "핑크",
};

export const templatePresetColorOptions = templatePresetColors.map((color) => ({
  color,
  name: templatePresetColorNames[color],
}));

const colorSchema = z.enum(templatePresetColors);
const backgroundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("color"), color: colorSchema }).strict(),
  z.object({ kind: z.literal("image"), assetId: z.enum(stockBackgroundIds) }).strict(),
]);

const textLayerSchema = z.object({
  visible: z.boolean(),
  x: z.number().int().min(0).max(TEMPLATE_CANVAS.width),
  y: z.number().int().min(0).max(TEMPLATE_CANVAS.height),
  maxWidth: z.number().int().min(180).max(TEMPLATE_CANVAS.width),
  fontSize: z.number().int().min(20).max(96),
  color: colorSchema,
  backgroundColor: colorSchema.nullable(),
}).strict();

const videoLayerSchema = z.object({
  aspectRatio: z.enum(videoAspectRatios),
  x: z.number().int().min(0).max(TEMPLATE_CANVAS.width - 240),
  y: z.number().int().min(0).max(TEMPLATE_CANVAS.height - 135),
  width: z.number().int().min(240).max(TEMPLATE_CANVAS.width),
  height: z.number().int().min(135).max(TEMPLATE_CANVAS.height),
  fit: z.literal("cover"),
}).strict();

const legacyTitleLayerSchema = textLayerSchema.extend({
  fontSize: z.number().int().min(24).max(96),
  primaryColor: colorSchema,
  accentColor: colorSchema,
}).omit({ color: true }).strict();

const titleLayerSchema = textLayerSchema.omit({ color: true, backgroundColor: true }).extend({
  fontSize: z.number().int().min(24).max(96),
  primaryColor: colorSchema,
  accentColor: colorSchema,
  primaryBackgroundColor: colorSchema.nullable(),
  accentBackgroundColor: colorSchema.nullable(),
}).strict();

const commentLayerSchema = z.object({
  visible: z.boolean(),
  theme: z.enum(["dark", "light"]),
  size: z.enum(["small", "medium", "large"]),
  y: z.number().int().min(0).max(TEMPLATE_CANVAS.height),
  dockedToVideo: z.boolean(),
}).strict();

const sharedTemplateLayers = {
  background: backgroundSchema,
  video: videoLayerSchema,
  subtitle: textLayerSchema.extend({ fontSize: z.number().int().min(24).max(72) }).strict(),
  channel: textLayerSchema.extend({ fontSize: z.number().int().min(20).max(64) }).strict(),
} as const;

export const unifiedSubtitleVariants = ["highlight", "pop"] as const;
export type UnifiedSubtitleVariant = (typeof unifiedSubtitleVariants)[number];

const unifiedSubtitleLayerSchema = textLayerSchema.omit({
  backgroundColor: true,
}).extend({
  x: z.literal(TEMPLATE_CANVAS.width / 2),
  variant: z.enum(unifiedSubtitleVariants),
  fontId: z.enum(editorFontIds),
  fontSize: z.number().int().min(24).max(120),
  accentColor: colorSchema,
}).strict();

const unifiedTitleLayerSchema = titleLayerSchema.extend({
  fontId: z.enum(editorFontIds),
}).strict();

const versionFiveTemplateConfigSchema = z.object({
  schemaVersion: z.literal(5),
  background: backgroundSchema,
  video: videoLayerSchema,
  title: unifiedTitleLayerSchema,
  subtitle: unifiedSubtitleLayerSchema,
  channel: sharedTemplateLayers.channel,
  comment: commentLayerSchema,
}).strict();

const currentTemplateConfigSchema = z.object({
  schemaVersion: z.literal(4),
  ...sharedTemplateLayers,
  title: titleLayerSchema,
  comment: commentLayerSchema,
}).strict();

const versionThreeTemplateConfigSchema = z.object({
  schemaVersion: z.literal(3),
  ...sharedTemplateLayers,
  title: titleLayerSchema,
  comment: commentLayerSchema,
}).strict();

const previousTemplateConfigSchema = z.object({
  schemaVersion: z.literal(2),
  ...sharedTemplateLayers,
  title: titleLayerSchema,
}).strict().transform((config) => ({
  ...config,
  schemaVersion: 3 as const,
  comment: defaultCommentLayer(config.video),
}));

const legacyTemplateConfigSchema = z.object({
  schemaVersion: z.literal(1),
  ...sharedTemplateLayers,
  title: legacyTitleLayerSchema,
}).strict().transform((config) => {
  const { backgroundColor, ...title } = config.title;
  return {
    ...config,
    schemaVersion: 3 as const,
    title: {
      ...title,
      primaryBackgroundColor: backgroundColor,
      accentBackgroundColor: backgroundColor,
    },
    comment: defaultCommentLayer(config.video),
  };
});

export const templateConfigSchema = z.union([
  versionFiveTemplateConfigSchema,
  currentTemplateConfigSchema,
  versionThreeTemplateConfigSchema,
  previousTemplateConfigSchema,
  legacyTemplateConfigSchema,
]).superRefine((config, context) => {
  const expectedHeight = Math.round(config.video.width * aspectHeightRatio(config.video.aspectRatio));
  if (Math.abs(config.video.height - expectedHeight) > 1) {
    context.addIssue({ code: "custom", path: ["video", "height"], message: "영상 프레임 비율이 올바르지 않습니다." });
  }
  if (config.video.x + config.video.width > TEMPLATE_CANVAS.width || config.video.y + config.video.height > TEMPLATE_CANVAS.height) {
    context.addIssue({ code: "custom", path: ["video"], message: "영상 프레임이 캔버스를 벗어났습니다." });
  }
  if (config.schemaVersion === 5) {
    const subtitleHeight = Math.max(140, config.subtitle.fontSize + 32);
    if (
      config.subtitle.y - subtitleHeight / 2 < 0
      || config.subtitle.y + subtitleHeight / 2 > TEMPLATE_CANVAS.height
    ) {
      context.addIssue({
        code: "custom",
        path: ["subtitle", "y"],
        message: "자막 영역이 캔버스를 벗어났습니다.",
      });
    }
  }
});

export type TemplateConfig = z.infer<typeof templateConfigSchema>;
export type TemplateConfigV5 = z.infer<typeof versionFiveTemplateConfigSchema>;

export const customTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  baseTemplateId: z.enum(templateIds),
  config: templateConfigSchema,
}).strict();

export type CustomTemplate = {
  id: string;
  name: string;
  baseTemplateId: TemplateId;
  config: TemplateConfig;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TemplateSnapshot = Pick<CustomTemplate, "id" | "name" | "baseTemplateId" | "config" | "version">;

export function aspectHeightRatio(aspectRatio: VideoAspectRatio) {
  const [width, height] = aspectRatio.split(":").map(Number);
  return height / width;
}

export function videoFrameForAspect(aspectRatio: VideoAspectRatio, width: number = TEMPLATE_CANVAS.width) {
  const height = Math.round(width * aspectHeightRatio(aspectRatio));
  const boundedWidth = height > TEMPLATE_CANVAS.height
    ? Math.floor(TEMPLATE_CANVAS.height / aspectHeightRatio(aspectRatio))
    : width;
  const boundedHeight = Math.round(boundedWidth * aspectHeightRatio(aspectRatio));
  return {
    aspectRatio,
    x: Math.round((TEMPLATE_CANVAS.width - boundedWidth) / 2),
    y: Math.round((TEMPLATE_CANVAS.height - boundedHeight) / 2),
    width: boundedWidth,
    height: boundedHeight,
    fit: "cover" as const,
  };
}

function defaultCommentLayer(video: { y: number; height: number }) {
  return {
    visible: true,
    theme: "dark" as const,
    size: "medium" as const,
    y: Math.min(TEMPLATE_CANVAS.height, video.y + video.height),
    dockedToVideo: true,
  };
}

export function createDefaultTemplateConfig(baseTemplateId: TemplateId = "dark-minimal"): TemplateConfig {
  const light = baseTemplateId === "white-yellow" || baseTemplateId === "paper";
  const accent = baseTemplateId === "comment-capture" ? "#35E6E3" : baseTemplateId === "white-yellow" ? "#FFD84D" : "#FF4D4F";
  const video = videoFrameForAspect(baseTemplateId === "comment-capture" ? "16:9" : "5:4");
  if (baseTemplateId === "comment-capture") video.y -= COMMENT_CAPTURE_LANDSCAPE_LIFT_PX;
  return {
    schemaVersion: 4,
    background: { kind: "color", color: baseTemplateId === "comment-capture" ? COMMENT_BACKGROUND_COLOR : light ? "#F3F0E9" : "#111111" },
    video,
    title: {
      visible: true, x: 540, y: baseTemplateId === "comment-capture" ? 90 : 250, maxWidth: 920, fontSize: 72,
      primaryColor: light ? "#111111" : "#FFFFFF", accentColor: accent,
      primaryBackgroundColor: null, accentBackgroundColor: null,
    },
    subtitle: {
      visible: false, x: 540, y: 1410, maxWidth: 900, fontSize: 48,
      color: "#FFFFFF", backgroundColor: "#000000",
    },
    channel: {
      visible: true, x: 540, y: baseTemplateId === "comment-capture" ? 1740 : 1650, maxWidth: 800, fontSize: 42,
      color: light ? "#353438" : "#FFFFFF", backgroundColor: null,
    },
    comment: {
      ...defaultCommentLayer(video),
      visible: baseTemplateId === "comment-capture",
    },
  };
}

export function isTemplateConfigV5(config: TemplateConfig): config is TemplateConfigV5 {
  return config.schemaVersion === 5;
}

export function upgradeTemplateConfigToV5(config: TemplateConfig): TemplateConfigV5 {
  if (isTemplateConfigV5(config)) return structuredClone(config);
  const {
    backgroundColor: legacySubtitleBackgroundColor,
    ...subtitle
  } = structuredClone(config.subtitle);
  void legacySubtitleBackgroundColor;
  return {
    ...structuredClone(config),
    schemaVersion: 5,
    title: {
      ...structuredClone(config.title),
      fontId: DEFAULT_EDITOR_FONT_ID,
    },
    subtitle: {
      ...subtitle,
      visible: false,
      variant: "highlight",
      x: TEMPLATE_CANVAS.width / 2,
      fontId: DEFAULT_EDITOR_FONT_ID,
      fontSize: Math.min(120, Math.max(24, config.subtitle.fontSize)),
      accentColor: "#FFD84D",
    },
  };
}

export function createUnifiedSubtitleTemplateConfig(
  variant: UnifiedSubtitleVariant,
  baseTemplateId: TemplateId = "dark-minimal",
): TemplateConfigV5 {
  const config = upgradeTemplateConfigToV5(createDefaultTemplateConfig(baseTemplateId));
  config.subtitle.visible = true;
  config.subtitle.variant = variant;
  config.subtitle.fontSize = variant === "pop" ? 92 : 72;
  config.subtitle.accentColor = "#35E6E3";
  return config;
}

export function snapshotFromTemplate(template: CustomTemplate): TemplateSnapshot {
  return {
    id: template.id,
    name: template.name,
    baseTemplateId: template.baseTemplateId,
    config: template.config,
    version: template.version,
  };
}
