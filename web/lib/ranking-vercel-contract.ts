import { z } from "zod";
const sourceSchema = z.object({
  id: z.uuid(),
  duration: z.number().finite().min(0.5).max(1200),
  width: z.number().int().min(1).max(7680),
  height: z.number().int().min(1).max(7680),
  hasAudio: z.boolean(),
  previewReady: z.literal(true),
  durationKnown: z.literal(true),
  kind: z.literal("audio").optional(),
  remote: z
    .object({
      url: z.string().url(),
      platform: z.enum(["youtube", "tiktok", "instagram"]),
      videoId: z.string().max(100),
    })
    .optional(),
});
export function rankingVercelResult(
  project: string,
  operation: string,
  sourceId: string | null,
  value: unknown,
) {
  if (sourceId) {
    const parsed = z.object({ source: sourceSchema }).parse(value);
    if (parsed.source.id !== sourceId) throw new Error("Wrong source result");
    return parsed;
  }
  const parsed = z
    .object({
      duration: z.number().finite().positive().max(180.25),
      outputKey: z.literal(`outputs/ranking/${project}/${operation}.mp4`),
    })
    .parse(value);
  return parsed;
}

/** Only explicit worker stages and measured download percentages reach the UI. */
export function rankingVercelProgress(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  if (!["preparing", "downloading", "converting"].includes(String(input.stage))) return undefined;
  const percent = input.stage === "downloading" && typeof input.percent === "number" && Number.isFinite(input.percent)
    ? Math.max(0, Math.min(100, input.percent)) : undefined;
  return {stage: input.stage as "preparing" | "downloading" | "converting", ...(percent === undefined ? {} : {percent})};
}
