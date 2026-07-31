import { z } from "zod";

export const jobCompletionEmailDecisionSchema = z.object({
  status: z.enum(["enabled", "declined"]),
}).strict();

export const notificationEmailSchema = z.string()
  .trim()
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());

export const emailPreferenceDecisionSchema =
  jobCompletionEmailDecisionSchema.extend({
    marketingStatus: z.enum(["enabled", "declined"]),
    email: notificationEmailSchema.optional(),
  }).strict();

export type JobCompletionEmailDecision =
  z.infer<typeof jobCompletionEmailDecisionSchema>["status"];

export type MarketingEmailDecision =
  z.infer<typeof emailPreferenceDecisionSchema>["marketingStatus"];

export type JobCompletionEmailPreferenceStatus =
  | "not_asked"
  | JobCompletionEmailDecision;

export type JobCompletionEmailPreferenceResponse = {
  available: boolean;
  status: JobCompletionEmailPreferenceStatus;
  marketingStatus: JobCompletionEmailPreferenceStatus;
  email: string | null;
  promptDue: boolean;
  completedJobCount?: number;
  nextPromptCompletedJobCount?: number | null;
};

export function jobCompletionEmailPreferenceAvailable() {
  return Boolean(
    process.env.RESEND_API_KEY?.trim()
    && process.env.RESEND_FROM_EMAIL?.trim(),
  );
}
