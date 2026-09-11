import { creatorError, creatorJson, getCreatorMe } from "@/lib/creator-support-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return creatorJson(await getCreatorMe()); }
  catch (error) { return creatorError(error); }
}
