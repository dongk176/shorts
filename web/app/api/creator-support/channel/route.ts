import { createHash } from "node:crypto";
import { z } from "zod";
import { creatorChannelSchema, CREATOR_SUPPORT_PROGRAM, normalizeCreatorChannel } from "@/lib/creator-support";
import { assertCreatorAccount, creatorError, creatorJson, creatorSchemaReady, requireCreatorAccount } from "@/lib/creator-support-server";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { readCreatorJson } from "@/lib/creator-support-upload";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request);
    const account = await requireCreatorAccount();
    const input = creatorChannelSchema.pick({ platform: true, channelUrl: true }).extend({ accountKey: z.string() }).strict().parse(await readCreatorJson(request, 2000));
    assertCreatorAccount(input.accountKey, account);
    let channel: ReturnType<typeof normalizeCreatorChannel>;
    try { channel = normalizeCreatorChannel(input.platform, input.channelUrl); }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "채널 주소를 확인해 주세요."); }
    if (await creatorSchemaReady()) {
      const hash = createHash("sha256").update(channel.channelKey).digest("hex");
      const [duplicate] = await getDb()`select id from shorts_mvp.creator_support_enrollments
        where program_code=${CREATOR_SUPPORT_PROGRAM} and channel_hash=${hash} and user_id<>${account.id} limit 1`;
      if (duplicate) throw new HttpError(409, "이미 신청된 채널입니다.", "CHANNEL_ALREADY_ENROLLED");
    }
    return creatorJson({ channelUrl: channel.channelUrl, available: true });
  } catch (error) { return creatorError(error); }
}
