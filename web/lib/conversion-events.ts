import { z } from "zod";

// No arbitrary text, URLs, account identifiers, prices, or payment payloads.
export const conversionEventSchema = z.object({
  id: z.uuid(),
  name: z.enum(["pricing_viewed", "upgrade_clicked", "checkout_clicked", "checkout_opened", "checkout_closed", "checkout_error"]),
  locale: z.enum(["ko", "en", "ja"]),
  surface: z.enum(["pricing", "header", "credit_notice", "creation", "billing"]),
  provider: z.enum(["paddle", "toss", "paypal", "domestic"]).optional(),
  stage: z.enum(["api", "sdk", "provider", "script"]).optional(),
}).strict();

export type ConversionEvent = z.infer<typeof conversionEventSchema>;

export type StoredConversionEvent = Omit<ConversionEvent, "name" | "surface"> & {
  name: ConversionEvent["name"] | "download_requested";
  surface: ConversionEvent["surface"] | "short_download" | "project_download";
};
