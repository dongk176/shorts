import type { Sql } from "postgres";
import type { GuideEvent } from "./schema";
export type AnalyticsEnvironment = "production" | "preview" | "development";
export async function saveGuideEvents(
  db: Sql,
  events: GuideEvent[],
  environment: AnalyticsEnvironment,
) {
  // Bind as text before casting to jsonb: postgres.js otherwise JSON-encodes an
  // already serialized string when the parameter is inferred as jsonb.
  await db`
    insert into shorts_mvp.shorts_guide_events(id,survey_id,sequence,event_name,locale,guide_version,environment,question,answer,answers,guide,action)
    select x.id,x.survey_id,x.sequence,x.event_name,x.locale,x.guide_version,${environment},x.question,x.answer,x.answers,x.guide,x.action
    from jsonb_to_recordset(${JSON.stringify(events.map((e) => ({ id: e.id, survey_id: e.surveyId, sequence: e.sequence, event_name: e.name, locale: e.locale, guide_version: e.version, question: e.question, answer: e.answer, answers: e.answers, guide: e.guide, action: e.action })))}::text::jsonb)
      as x(id uuid,survey_id uuid,sequence int,event_name text,locale text,guide_version text,question text,answer text,answers jsonb,guide text,action text)
    on conflict do nothing
  `;
}
