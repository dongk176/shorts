import { describe, expect, it, vi } from "vitest";
import { downloadableEbookSlugs } from "@/lib/ebook-entitlements";

vi.mock("@/lib/billing", () => ({
  getBillingSummary: vi.fn(async () => ({
    billingCycle: "yearly",
    canCreateJobs: true,
    planCode: "starter_3m",
  })),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: vi.fn(async () => ({
    userId: "ebook-download-test-user",
  })),
}));

import { GET } from "./route";

describe("ebook download route", () => {
  it.each(downloadableEbookSlugs)("returns the original PDF for %s", async (slug) => {
    const response = await GET(
      new Request(`http://localhost/api/ebooks/${slug}/download`),
      { params: Promise.resolve({ slug }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("attachment;");

    const signature = Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString();
    expect(signature).toBe("%PDF");
  });
});
