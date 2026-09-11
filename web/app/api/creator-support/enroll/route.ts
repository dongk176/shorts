import { creatorEnrollmentSchema } from "@/lib/creator-support";
import { creatorError, creatorJson, enrollCreator, requireCreatorAccount } from "@/lib/creator-support-server";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { readCreatorJson } from "@/lib/creator-support-upload";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request);
    const account = await requireCreatorAccount();
    const input = creatorEnrollmentSchema.parse(await readCreatorJson(request, 8000));
    return creatorJson({ status: await enrollCreator(account, input) });
  } catch (error) { return creatorError(error); }
}
