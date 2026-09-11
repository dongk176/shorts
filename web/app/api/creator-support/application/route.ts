import { creatorApplicationSchema } from "@/lib/creator-application";
import { getCreatorApplicationMe, submitCreatorApplication } from "@/lib/creator-application-server";
import { creatorError, creatorJson, requireCreatorAccount } from "@/lib/creator-support-server";
import { readCreatorJson } from "@/lib/creator-support-upload";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return creatorJson(await getCreatorApplicationMe()); }
  catch (error) { return creatorError(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request);
    const account = await requireCreatorAccount();
    const input = creatorApplicationSchema.parse(await readCreatorJson(request, 8000));
    return creatorJson({ application: await submitCreatorApplication(account, input) });
  } catch (error) { return creatorError(error); }
}
