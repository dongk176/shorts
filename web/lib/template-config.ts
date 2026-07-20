import { z } from "zod";
import { templateIds, videoAspectRatios, type TemplateId, type VideoAspectRatio } from "@/lib/contracts";

export const TEMPLATE_CANVAS = { width: 1080, height: 1920 } as const;
export const MAX_PERSONAL_TEMPLATES = 50;

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
  "#000000", "#111111", "#1B1B1E", "#353438", "#64748B", "#FFFFFF", "#F3F0E9",
  "#E32626", "#FF4D4F", "#FF715E", "#FFB4A8", "#F97316", "#FFD84D", "#8BFF5A",
  "#16A34A", "#35E6E3", "#3B82F6", "#2563EB", "#A78BFA", "#DB2777",
] as const;

export type TemplatePresetColor = (typeof templatePresetColors)[number];

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

export const templateConfigSchema = z.object({
  schemaVersion: z.literal(1),
  background: backgroundSchema,
  video: z.object({
    aspectRatio: z.enum(videoAspectRatios),
    x: z.number().int().min(0).max(TEMPLATE_CANVAS.width - 240),
    y: z.number().int().min(0).max(TEMPLATE_CANVAS.height - 135),
    width: z.number().int().min(240).max(TEMPLATE_CANVAS.width),
    height: z.number().int().min(135).max(TEMPLATE_CANVAS.height),
    fit: z.literal("cover"),
  }).strict(),
  title: textLayerSchema.extend({
    fontSize: z.number().int().min(24).max(96),
    primaryColor: colorSchema,
    accentColor: colorSchema,
  }).omit({ color: true }).strict(),
  subtitle: textLayerSchema.extend({ fontSize: z.number().int().min(24).max(72) }).strict(),
  channel: textLayerSchema.extend({ fontSize: z.number().int().min(20).max(64) }).strict(),
}).strict().superRefine((config, context) => {
  const expectedHeight = Math.round(config.video.width * aspectHeightRatio(config.video.aspectRatio));
  if (Math.abs(config.video.height - expectedHeight) > 1) {
    context.addIssue({ code: "custom", path: ["video", "height"], message: "영상 프레임 비율이 올바르지 않습니다." });
  }
  if (config.video.x + config.video.width > TEMPLATE_CANVAS.width || config.video.y + config.video.height > TEMPLATE_CANVAS.height) {
    context.addIssue({ code: "custom", path: ["video"], message: "영상 프레임이 캔버스를 벗어났습니다." });
  }
});

export type TemplateConfig = z.infer<typeof templateConfigSchema>;

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

export function createDefaultTemplateConfig(baseTemplateId: TemplateId = "dark-minimal"): TemplateConfig {
  const light = baseTemplateId === "white-yellow" || baseTemplateId === "paper";
  const accent = baseTemplateId === "comment-capture" ? "#35E6E3" : baseTemplateId === "white-yellow" ? "#FFD84D" : "#FF4D4F";
  return {
    schemaVersion: 1,
    background: { kind: "color", color: light ? "#F3F0E9" : "#111111" },
    video: videoFrameForAspect("5:4"),
    title: {
      visible: true, x: 540, y: 250, maxWidth: 920, fontSize: 72,
      primaryColor: light ? "#111111" : "#FFFFFF", accentColor: accent,
      backgroundColor: null,
    },
    subtitle: {
      visible: true, x: 540, y: 1410, maxWidth: 900, fontSize: 48,
      color: "#FFFFFF", backgroundColor: "#000000",
    },
    channel: {
      visible: true, x: 540, y: 1650, maxWidth: 800, fontSize: 42,
      color: light ? "#353438" : "#FFFFFF", backgroundColor: null,
    },
  };
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
