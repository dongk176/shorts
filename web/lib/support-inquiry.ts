import { z } from "zod";

export const supportInquiryCategories = [
  "service_usage",
  "billing_refund",
  "technical_issue",
  "other",
] as const;

export type SupportInquiryCategory = (typeof supportInquiryCategories)[number];

export const supportInquiryRefundReasons = [
  "unused_or_changed_mind",
  "duplicate_payment",
  "service_issue",
  "billing_error",
  "other",
] as const;

export type SupportInquiryRefundReason = (typeof supportInquiryRefundReasons)[number];

export const supportInquirySubmissionSchema = z.object({
  requestId: z.uuid(),
  category: z.enum(supportInquiryCategories),
  contactEmail: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  message: z.string().trim().min(10).max(2000),
  locale: z.enum(["ko", "en", "ja"]),
  pagePath: z.string().trim().min(1).max(2048).regex(/^\/[^\s]*$/).nullable(),
  inquiryKind: z.enum(["general", "refund_request"]).default("general"),
  billingOrderId: z.uuid().nullable().default(null),
  refundReasonCode: z.enum(supportInquiryRefundReasons).nullable().default(null),
}).superRefine((value, context) => {
  const refundRequest = value.inquiryKind === "refund_request";
  if (
    refundRequest
      ? value.category !== "billing_refund"
        || !value.billingOrderId
        || !value.refundReasonCode
      : value.billingOrderId !== null || value.refundReasonCode !== null
  ) {
    context.addIssue({
      code: "custom",
      path: ["inquiryKind"],
      message: "환불 요청 정보를 다시 확인해 주세요.",
    });
  }
});

export const SUPPORT_INQUIRY_MAX_PER_HOUR = 5;
