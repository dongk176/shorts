import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { apiError, HttpError } from "@/lib/http";
import { libraryGuideSlugs, guidePdfLocale } from "@/lib/shorts-guides/catalog";
import { canDownloadStrategyGuides } from "@/lib/shorts-guides/access";
import { siteLocales } from "@/lib/i18n/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.object({
  slug: z.enum(libraryGuideSlugs),
  locale: z.enum(siteLocales),
});
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug, locale } = input.parse({
      ...(await context.params),
      locale: new URL(request.url).searchParams.get("lang") || "ko",
    });
    const session = await requireAuthenticatedMvpSession({
      readOnly: true,
      createIfMissing: false,
    });
    const billing = await getBillingSummary(getDb(), session.userId);
    if (!canDownloadStrategyGuides(billing))
      throw new HttpError(
        403,
        "An active paid plan is required.",
        "PAID_PLAN_REQUIRED",
      );
    const fileLocale = guidePdfLocale(slug, locale);
    const file = await readFile(
      path.join(
        process.cwd(),
        "private",
        "shorts-guides",
        fileLocale,
        `${slug}.pdf`,
      ),
    );
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="EasyCut-${slug}-${fileLocale}.pdf"`,
        "Content-Length": String(file.byteLength),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = apiError(
      error,
      "Could not download the guide. Please try again.",
    );
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  }
}
