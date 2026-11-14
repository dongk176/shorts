import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import postgres, { type Sql } from "postgres";
import { expect, it, vi } from "vitest";
import { processJobCompletionEmailNotifications } from "./job-completion-email";

it("joins each claimed job's language in SQL and claims the batch only once", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema shorts_mvp;
      create table shorts_mvp.video_jobs(id uuid primary key, output_language text);
      create table shorts_mvp.job_completion_email_notifications(
        job_id uuid primary key,status text,sent_at timestamptz,claimed_at timestamptz,
        provider_message_id text,last_error text
      );
      create table claim_counter(n int);
      insert into claim_counter values(0);
      insert into shorts_mvp.video_jobs values
        ('00000000-0000-0000-0000-000000000001','ja'),
        ('00000000-0000-0000-0000-000000000002','ko');
      insert into shorts_mvp.job_completion_email_notifications(job_id,status)
        select id,'processing' from shorts_mvp.video_jobs;
      create function shorts_mvp.claim_job_completion_email_notifications(integer)
      returns table(job_id uuid,user_id uuid,recipient_email text,display_name text,
                    project_number bigint,video_title text,attempt_count integer)
      language plpgsql as $$ begin
        update claim_counter set n=n+1;
        return query select id,id,'owner@example.com'::text,null::text,
          row_number() over()::bigint,'source'::text,1 from shorts_mvp.video_jobs;
      end $$;
    `);
    const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const query = parts.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, "");
      const result = await db.query<Record<string, unknown>>(query, values);
      return result.rows.map(row => Object.fromEntries(Object.entries(row).map(
        ([key, value]) => [postgres.toCamel(key), value],
      )));
    };
    const send = vi.fn().mockResolvedValue("test-provider-id");
    expect(await processJobCompletionEmailNotifications(sql as unknown as Sql, send))
      .toEqual({ claimed: 2, sent: 2, retried: 0, failed: 0 });
    expect(send.mock.calls.map(([claim]) => claim.outputLanguage).sort()).toEqual(["ja", "ko"]);
    expect((await db.query("select n from claim_counter")).rows).toEqual([{ n: 1 }]);
  } finally {
    await db.close();
  }
});
