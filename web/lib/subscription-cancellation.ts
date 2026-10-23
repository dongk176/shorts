import { z } from "zod";

export const cancellationReasons = ["price", "less_usage", "quality", "missing_features", "technical", "alternative", "other"] as const;
export const cancellationFeedbackSchema = z.object({
  reason: z.enum(cancellationReasons),
  detail: z.string().trim().max(1000).default(""),
  message: z.string().trim().max(2000).default(""),
  alternativeService: z.string().trim().max(100).default(""),
  alternativeUndecided: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  if (value.reason === "other" && !value.detail) {
    ctx.addIssue({ code: "custom", path: ["detail"], message: "기타 해지 사유를 입력해 주세요." });
  }
  if (value.reason !== "alternative" && (value.alternativeService || value.alternativeUndecided)) {
    ctx.addIssue({ code: "custom", path: ["alternativeService"], message: "다른 서비스 선택 항목을 확인해 주세요." });
  }
  if (value.alternativeService && value.alternativeUndecided) {
    ctx.addIssue({ code: "custom", path: ["alternativeService"], message: "서비스명 또는 미정 중 하나만 선택해 주세요." });
  }
});
export type CancellationFeedback = z.infer<typeof cancellationFeedbackSchema>;
export const cancellationRequestSchema = z.discriminatedUnion("cancelAtPeriodEnd", [
  z.object({ cancelAtPeriodEnd: z.literal(true), feedback: cancellationFeedbackSchema }).strict(),
  z.object({ cancelAtPeriodEnd: z.literal(false) }).strict(),
]);
