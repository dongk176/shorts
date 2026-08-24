import type { Sql } from "postgres";
import type { DownloadableEbookSlug } from "@/lib/ebook-entitlements";
import { HttpError } from "@/lib/http";

export const EBOOK_DOWNLOAD_LIMIT = 10;

type EbookDownloadCounterRow = {
  downloadCount: number;
};

export async function claimEbookDownload(
  db: Sql,
  userId: string,
  ebookSlug: DownloadableEbookSlug,
) {
  const rows = await db<EbookDownloadCounterRow[]>`
    insert into shorts_mvp.ebook_download_counters (
      user_id,
      ebook_slug,
      download_count
    ) values (
      ${userId},
      ${ebookSlug},
      1
    )
    on conflict (user_id,ebook_slug) do update set
      download_count = shorts_mvp.ebook_download_counters.download_count + 1,
      last_downloaded_at = now()
    where shorts_mvp.ebook_download_counters.download_count < ${EBOOK_DOWNLOAD_LIMIT}
    returning download_count
  `;
  const downloadCount = Number(rows[0]?.downloadCount);
  if (!Number.isInteger(downloadCount)) {
    throw new HttpError(
      429,
      `이 전자책의 다운로드 가능 횟수 ${EBOOK_DOWNLOAD_LIMIT}회를 모두 사용했습니다.`,
      "EBOOK_DOWNLOAD_LIMIT_REACHED",
    );
  }

  return {
    downloadCount,
    limit: EBOOK_DOWNLOAD_LIMIT,
    remaining: EBOOK_DOWNLOAD_LIMIT - downloadCount,
  };
}
