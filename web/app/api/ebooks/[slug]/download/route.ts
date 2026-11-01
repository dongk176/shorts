import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import {
  assertEbookDownloadAccess,
  downloadableEbookSlugs,
} from "@/lib/ebook-entitlements";
import { ebookDownloadName, ebookRelativePdfPath } from "@/lib/ebook-catalog";
import { siteLocales } from "@/lib/i18n/config";
import { claimEbookDownload } from "@/lib/ebook-downloads";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ slug: z.enum(downloadableEbookSlugs), locale: z.enum(siteLocales) });

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { slug, locale } = paramsSchema.parse({
      ...(await context.params),
      locale: new URL(request.url).searchParams.get("lang") ?? "ko",
    });
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const billing = await getBillingSummary(db, session.userId);
    assertEbookDownloadAccess(billing);
    const file = await readFile(path.join(process.cwd(), "private", "ebooks", ebookRelativePdfPath(slug, locale)));
    const download = await claimEbookDownload(db, session.userId, slug);
    const encodedName = encodeURIComponent(ebookDownloadName(slug, locale));
    return new Response(new Uint8Array(file), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="easy-cut-shortform-guide.pdf"; filename*=UTF-8''${encodedName}`,
        "Content-Length": String(file.byteLength),
        "Content-Type": "application/pdf",
        "Content-Language": locale,
        "X-Content-Type-Options": "nosniff",
        "X-Ebook-Downloads-Limit": String(download.limit),
        "X-Ebook-Downloads-Remaining": String(download.remaining),
      },
    });
  } catch (error) {
    return apiError(error, "전자책을 다운로드하지 못했습니다.");
  }
}
