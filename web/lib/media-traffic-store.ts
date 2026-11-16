import "server-only";
import { getDb } from "./db";
import type { z } from "zod";
import { trafficEventSchema } from "./media-traffic";
let lastCleanup = 0;
export async function saveTrafficEvents(
  events: z.infer<typeof trafficEventSchema>[],
  context: {
    userId: string | null;
    projectId: string | null;
    provider: string;
    measurement: string;
    environment: string;
  },
) {
  if (!events.length) return;
  const db = getDb();
  await db`insert into shorts_mvp.media_traffic_events ${db(
    events.map((e) => ({
      id: e.id,
      user_id: context.userId,
      project_id: context.projectId,
      resource: e.resource,
      provider: context.provider,
      purpose: e.purpose,
      measurement: e.bytes === null ? "unmeasured" : context.measurement,
      bytes: e.bytes,
      interrupted: e.interrupted,
      environment: context.environment,
    })),
    "id",
    "user_id",
    "project_id",
    "resource",
    "provider",
    "purpose",
    "measurement",
    "bytes",
    "interrupted",
    "environment",
  )} on conflict(id) do nothing`;
  // Bounded retention maintenance runs only in the telemetry request, never in media delivery.
  if (Date.now() - lastCleanup > 3600000) {
    lastCleanup = Date.now();
    await db`delete from shorts_mvp.media_traffic_events where id in (select id from shorts_mvp.media_traffic_events where recorded_at<now()-interval '90 days' order by recorded_at limit 5000)`.catch(
      () => {},
    );
  }
}
