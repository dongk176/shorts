import { describe, expect, it } from "vitest";
import ArchivedRefundPolicyVersionsLayout from "./layout";
import RefundPolicyVersionOnePage from "./1/page";
import RefundPolicyVersionTwoPage from "./2/page";
import RefundPolicyVersionThreePage from "./3/page";

describe("archived refund policy routes", () => {
  it.each([
    ["archive layout", ArchivedRefundPolicyVersionsLayout],
    ["v1", RefundPolicyVersionOnePage],
    ["v2", RefundPolicyVersionTwoPage],
    ["v3", RefundPolicyVersionThreePage],
  ])("returns the Next.js 404 boundary for %s", (_label, render) => {
    expect(() => render()).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
