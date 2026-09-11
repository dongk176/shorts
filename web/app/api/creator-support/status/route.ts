import { creatorError, creatorJson, creatorSchemaReady, getCreatorStatus, requireCreatorAccount } from "@/lib/creator-support-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const account = await requireCreatorAccount();
    return creatorJson({ status: await creatorSchemaReady() ? await getCreatorStatus(account.id) : null });
  } catch (error) { return creatorError(error); }
}
