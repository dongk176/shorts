import { z } from "zod";

export const MARKETING_EMAIL_CONSENT_VERSION = "2026-08-14-v2";

export const marketingEmailSchema = z.string()
  .trim()
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());

export const marketingEmailDecisionSchema = z.object({
  status: z.enum(["enabled", "declined"]),
  email: marketingEmailSchema.optional(),
}).strict();

export type MarketingEmailDecision =
  z.infer<typeof marketingEmailDecisionSchema>["status"];

export type MarketingEmailPreferenceStatus =
  | "not_asked"
  | MarketingEmailDecision;

export type MarketingEmailPreferenceResponse = {
  available: boolean;
  eligible: boolean;
  status: MarketingEmailPreferenceStatus;
  email: string | null;
  promptDue: boolean;
  completedJobCount: number;
};

export function marketingEmailPreferenceAvailable() {
  return Boolean(
    process.env.RESEND_API_KEY?.trim()
    && process.env.RESEND_FROM_EMAIL?.trim(),
  );
}
