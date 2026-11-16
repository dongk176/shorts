import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { getDb } from "@/lib/db";
import { rankingBody, requireRankingOrigin } from "@/lib/ranking-access";
import { trafficEventSchema, trafficEnvironment } from "@/lib/media-traffic";
import { saveTrafficEvents } from "@/lib/media-traffic-store";
import manifest from "@/lib/ranking-showroom-delivery.json";
const schema = z.object({ events: z.array(trafficEventSchema).min(1).max(20) });
export async function POST(request: Request) {
  try {
    requireRankingOrigin(request);
    const { events } = schema.parse(await rankingBody(request));
    if (
      events.some(
        (e) =>
          e.purpose !== "home_example" ||
          !Object.hasOwn(manifest.assets, e.resource) || (e.bytes !== null && e.bytes > (manifest.assets[e.resource as keyof typeof manifest.assets]?.bytes ?? 0)),
      )
    )
      return new Response(null, { status: 400 });
    const auth = await getAuthenticatedUser();
    const db = getDb();
    const user = auth
      ? await db`select id from shorts_mvp.app_users where auth_user_id=${auth.id} limit 1`
      : [];
    const recent =
      await db`select count(*)::int as count from shorts_mvp.media_traffic_events where recorded_at>now()-interval '1 minute' and measurement in ('browser_resource','unmeasured')`;
    if (recent[0].count >= 5000) return new Response(null, { status: 429 });
    await saveTrafficEvents(events, {
      userId: user[0]?.id || null,
      projectId: null,
      provider: "aws_cloudfront",
      measurement: "browser_resource",
      environment: trafficEnvironment(new URL(request.url).hostname),
    });
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 400 });
  }
}
