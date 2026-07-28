import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadableEbookSlugs } from "@/lib/ebook-entitlements";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
}));

vi.mock("@/lib/billing", () => ({
  getBillingSummary: vi.fn(async () => ({
    activeProducts: [{
      planCode: "starter_3m",
      displayName: "스타터",
      billingCycle: "yearly",
      currentPeriodStart: "2026-07-01T00:00:00.000Z",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      nextChargeAt: null,
      cancelAtPeriodEnd: false,
      monthlySourceSeconds: 12_000,
    }],
  })),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(() => mocks.db),
}));

vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: vi.fn(async () => ({
    userId: "ebook-download-test-user",
  })),
}));

import { GET } from "./route";

describe("ebook download route", () => {
  beforeEach(() => {
    mocks.db.mockReset();
    mocks.db.mockResolvedValue([{ downloadCount: 1 }]);
  });

  it.each(downloadableEbookSlugs)("returns the original PDF for %s", async (slug) => {
    const response = await GET(
      new Request(`http://localhost/api/ebooks/${slug}/download`),
      { params: Promise.resolve({ slug }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("x-ebook-downloads-limit")).toBe("10");
    expect(response.headers.get("x-ebook-downloads-remaining")).toBe("9");

    const signature = Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString();
    expect(signature).toBe("%PDF");
  });

  it("rejects an eleventh download without returning the PDF", async () => {
    mocks.db.mockResolvedValueOnce([]);

    const response = await GET(
      new Request("http://localhost/api/ebooks/viral-formula/download"),
      { params: Promise.resolve({ slug: "viral-formula" }) },
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: "EBOOK_DOWNLOAD_LIMIT_REACHED",
    });
  });

  it("allows the tenth download and reports zero remaining", async () => {
    mocks.db.mockResolvedValueOnce([{ downloadCount: 10 }]);

    const response = await GET(
      new Request("http://localhost/api/ebooks/title-300/download"),
      { params: Promise.resolve({ slug: "title-300" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-ebook-downloads-remaining")).toBe("0");
  });
});
