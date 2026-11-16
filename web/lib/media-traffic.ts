import { z } from "zod";
export const trafficPurposes = [
  "source_download",
  "source_preview",
  "sequence_preview",
  "thumbnail",
  "upload",
  "render_output",
  "home_example",
  "result_playback",
  "result_download",
] as const;
export const trafficEventSchema = z.object({
  id: z.string().uuid(),
  resource: z.string().min(1).max(200),
  purpose: z.enum(trafficPurposes),
  bytes: z
    .number()
    .int()
    .min(0)
    .max(10 * 1024 ** 3)
    .nullable(),
  interrupted: z.boolean().default(false),
});
export function trafficPurpose(value: string | null) {
  return ["sequence_preview", "thumbnail"].includes(value || "")
    ? value!
    : "source_preview";
}
export function trafficEnvironment(host: string) {
  return ["www.easycut.co.kr", "easycut.co.kr"].includes(host)
    ? "production"
    : "candidate";
}
export function formatTrafficBytes(bytes: number | null) {
  if (bytes === null) return "미측정";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
