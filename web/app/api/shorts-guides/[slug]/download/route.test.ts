import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  billing: vi.fn(),
  read: vi.fn(),
  db: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.auth,
}));
vi.mock("@/lib/billing", () => ({ getBillingSummary: mocks.billing }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.read }));
import { GET } from "./route";
import { HttpError } from "@/lib/http";
import { libraryGuideSlugs, guidePdfLocale } from "@/lib/shorts-guides/catalog";
const call = (slug: string, lang = "ko") =>
  GET(
    new Request(
      `http://localhost/api/shorts-guides/${slug}/download?lang=${lang}`,
    ),
    { params: Promise.resolve({ slug }) },
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ userId: "member" });
  mocks.billing.mockResolvedValue({
    hasPaymentHistory: true,
    activeProducts: [
      {
        planCode: "toss_easycut_pro_1m",
        currentPeriodStart: "2020-01-01",
        currentPeriodEnd: "2099-01-01",
      },
    ],
  });
  mocks.read.mockResolvedValue(Buffer.from("%PDF-1.4 test"));
});
describe("private strategy downloads", () => {
  it("does not read a file for an unauthenticated or non-paying user", async () => {
    mocks.auth.mockRejectedValueOnce(new HttpError(401, "Sign in"));
    expect((await call("affiliate")).status).toBe(401);
    expect(mocks.billing).not.toHaveBeenCalled();
    mocks.billing.mockResolvedValueOnce({
      hasPaymentHistory: false,
      activeProducts: [],
    });
    const res = await call("affiliate");
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("serves each authorized book and language from the private allowlisted path", async () => {
    for (const slug of libraryGuideSlugs)
      for (const locale of ["ko", "en", "ja"]) {
        const fileLocale = guidePdfLocale(slug, locale as "ko" | "en" | "ja");
        const res = await call(slug, locale);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/pdf");
        expect(res.headers.get("content-disposition")).toContain(
          `${slug}-${fileLocale}.pdf`,
        );
        expect(res.headers.get("cache-control")).toContain("private");
        expect(mocks.read).toHaveBeenLastCalledWith(
          expect.stringContaining(
            `/private/shorts-guides/${fileLocale}/${slug}.pdf`,
          ),
        );
      }
  });
  it("rejects unknown slugs and locales before authentication or filesystem access", async () => {
    for (const [slug, locale] of [
      ["../secret", "ko"],
      ["affiliate", "../../"],
      ["missing", "en"],
      ["affiliate", "jp"],
    ])
      expect((await call(slug, locale)).status).toBe(400);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("protects all new Korean books before reading any private file", async () => {
    for (const slug of ["after-work", "views-to-income", "weekend-shorts"]) {
      mocks.auth.mockRejectedValueOnce(new HttpError(401, "Sign in"));
      expect((await call(slug)).status).toBe(401);
      mocks.billing.mockResolvedValueOnce({ hasPaymentHistory: true, activeProducts: [] });
      expect((await call(slug, "en")).status).toBe(403);
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("fails closed when billing cannot be loaded", async () => {
    mocks.billing.mockRejectedValueOnce(new Error("timeout"));
    expect((await call("series")).status).toBe(503);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
