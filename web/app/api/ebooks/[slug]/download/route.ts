import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import {
  assertEbookDownloadAccess,
  downloadableEbookSlugs,
  type DownloadableEbookSlug,
} from "@/lib/ebook-entitlements";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ slug: z.enum(downloadableEbookSlugs) });
const downloadNames = {
  "monetization-7": "Easy_Cut_쇼츠_수익화_7가지_방법.pdf",
  "multi-platform": "Easy_Cut_유튜브_릴스_틱톡_동시_공략법.pdf",
  "copyright-survival": "Easy_Cut_쇼츠_저작권_생존_가이드.pdf",
  "monetization-playbook": "Easy_Cut_숏폼_수익화_실전_가이드.pdf",
  "viral-formula": "Easy_Cut_조회수_터지는_쇼츠의_공식.pdf",
  "low-views-diagnosis": "Easy_Cut_조회수가_안_나오는_쇼츠_진단서.pdf",
  "title-300": "Easy_Cut_클릭을_부르는_쇼츠_제목_300선.pdf",
} satisfies Record<DownloadableEbookSlug, string>;

type Context = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { slug } = paramsSchema.parse(await context.params);
    const session = await requireAuthenticatedMvpSession();
    const billing = await getBillingSummary(getDb(), session.userId);
    assertEbookDownloadAccess(billing);
    const file = await readFile(path.join(process.cwd(), "private", "ebooks", `${slug}.pdf`));
    const encodedName = encodeURIComponent(downloadNames[slug]);
    return new Response(new Uint8Array(file), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="easy-cut-shortform-guide.pdf"; filename*=UTF-8''${encodedName}`,
        "Content-Length": String(file.byteLength),
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error, "전자책을 다운로드하지 못했습니다.");
  }
}
