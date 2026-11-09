import type { Sql } from "postgres";
import type { StoredConversionEvent } from "./conversion-events";

export async function saveConversionEvent(db: Sql, userId: string, event: StoredConversionEvent, country: string | null = null) {
  const environment = process.env.VERCEL_ENV === "preview" ? "preview"
    : process.env.VERCEL_ENV === "production" ? "production" : "development";
  const deployment = process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 100) || null;
  const safeCountry = country && /^[A-Z]{2}$/.test(country) ? country : null;
  await db`
    insert into shorts_mvp.conversion_events
      (id,user_id,event_name,locale,surface,provider,stage,country,environment,deployment_id)
    select ${event.id}::uuid,u.id,${event.name},${event.locale},${event.surface},
      ${event.provider ?? null},${event.stage ?? null},${safeCountry},${environment},${deployment}
    from shorts_mvp.app_users u where u.id=${userId}::uuid and u.withdrawn_at is null
    on conflict (id) do nothing
  `;
}
