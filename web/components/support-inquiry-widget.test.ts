import fs from "node:fs";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  new URL("./support-inquiry-widget.tsx", import.meta.url),
  "utf8",
);

describe("support inquiry widget", () => {
  it("keeps billing questions but does not offer refund requests", () => {
    expect(source).toContain('category: "billing_refund"');
    expect(source).toContain('inquiryKind: "general"');
    expect(source).not.toContain('inquiryKind: "refund_request"');
    expect(source).not.toContain("/api/support/refundable-orders");
  });
});
