import { z } from "zod";
import { assertCreatorAccount, creatorError, creatorJson, creatorProgram, requireCreatorAccount } from "@/lib/creator-support-server";
import { prepareCreatorImage, readCreatorJson } from "@/lib/creator-support-upload";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request);
    const account = await requireCreatorAccount();
    const input = z.object({ accountKey: z.string(), image: z.string().max(2_800_000) }).strict().parse(await readCreatorJson(request, 2_810_000));
    assertCreatorAccount(input.accountKey, account);
    const program = await creatorProgram();
    if (!program?.enrollmentOpen) throw new HttpError(409, "현재 신규 모집을 준비 중이거나 마감했습니다.");
    const bytes = await prepareCreatorImage(input.image);
    const db = getDb();
    const id = await db.begin(async (tx) => {
      await tx`select id from shorts_mvp.app_users where id=${account.id} for update`;
      const [enrolled] = await tx`select id from shorts_mvp.creator_support_enrollments where user_id=${account.id}`;
      if (enrolled) throw new HttpError(409, "이미 참여한 계정입니다. 변경은 고객센터에 문의해 주세요.");
      const [count] = await tx`select count(*)::int as count from shorts_mvp.creator_support_assets where user_id=${account.id}`;
      if (count.count >= 5) throw new HttpError(429, "이미지를 여러 번 추가했어요. 등록된 이미지를 사용하거나 내일 다시 시도해 주세요.");
      const [row] = await tx`insert into shorts_mvp.creator_support_assets(user_id,image_bytes) values(${account.id},${bytes}) returning id`;
      return row.id;
    });
    return creatorJson({ assetId: id });
  } catch (error) { return creatorError(error); }
}
