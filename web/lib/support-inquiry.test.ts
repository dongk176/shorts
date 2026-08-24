import { describe, expect, it } from "vitest";
import { supportInquirySubmissionSchema } from "@/lib/support-inquiry";

const validSubmission = {
  requestId: "8dedb29b-e003-47e6-9e85-58b3a7d124fc",
  category: "billing_refund",
  contactEmail: "USER@Example.com ",
  message: "결제 내역을 확인한 뒤 환불 가능 여부를 알려주세요.",
  locale: "ko",
  pagePath: "/pricing",
};

describe("support inquiry submission", () => {
  it("normalizes a valid submission for storage", () => {
    expect(supportInquirySubmissionSchema.parse(validSubmission)).toMatchObject({
      category: "billing_refund",
      contactEmail: "user@example.com",
      pagePath: "/pricing",
      inquiryKind: "general",
      billingOrderId: null,
      refundReasonCode: null,
    });
  });

  it("accepts a refund request only when an order and reason are present", () => {
    expect(supportInquirySubmissionSchema.parse({
      ...validSubmission,
      inquiryKind: "refund_request",
      billingOrderId: "1e9b85a4-5fc6-4910-801d-ad137ce54b8c",
      refundReasonCode: "duplicate_payment",
    })).toMatchObject({
      inquiryKind: "refund_request",
      billingOrderId: "1e9b85a4-5fc6-4910-801d-ad137ce54b8c",
      refundReasonCode: "duplicate_payment",
    });

    expect(() => supportInquirySubmissionSchema.parse({
      ...validSubmission,
      inquiryKind: "refund_request",
      billingOrderId: null,
      refundReasonCode: "duplicate_payment",
    })).toThrow();
  });

  it("rejects short messages and non-site paths", () => {
    expect(() => supportInquirySubmissionSchema.parse({
      ...validSubmission,
      message: "짧아요",
    })).toThrow();
    expect(() => supportInquirySubmissionSchema.parse({
      ...validSubmission,
      pagePath: "https://external.example/path",
    })).toThrow();
  });
});
