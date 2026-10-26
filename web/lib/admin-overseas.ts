import "server-only";
import { requireOverseasAdminUser } from "@/lib/admin-overseas-auth";
import { getDb } from "@/lib/db";
import { overseasFilters, overseasPageSize, type OverseasData } from "@/lib/admin-overseas-contract";

// Classification describes recorded international usage, never nationality.
// Every aggregate and detail list uses the same server-side allowlist.
export async function loadAdminOverseas(params: Record<string, string | string[] | undefined>): Promise<OverseasData> {
  await requireOverseasAdminUser();
  const db = getDb();
  const filters = overseasFilters(params);
  const korean = "[가-힣ᄀ-ᇿㄱ-ㆎ]";
  const pattern = `%${filters.query.replace(/[\\%_]/g, "\\$&")}%`;
  const scope = db`
    eligible as materialized (
      select u.id,u.email,u.display_name,u.created_at
      from shorts_mvp.app_users u
      where u.withdrawn_at is null and not coalesce(u.is_admin,false)
        and not exists(select 1 from shorts_mvp.admin_role_assignments r where r.user_id=u.id)
        and concat_ws(' ',u.email,u.display_name) !~ ${korean}
        and lower(coalesce(u.email,'')) !~ '\\.kr$'
        -- Optional country fields are read without assuming a country column
        -- exists. The current schema does not persist geographic identity.
        and not exists (
          select 1 from jsonb_each_text(to_jsonb(u)) country
          where country.key in ('country','country_code','billing_country','signup_country')
            and lower(btrim(country.value)) in ('kr','kor','korea','south korea','republic of korea','대한민국','한국')
        )
        and (
          exists(select 1 from shorts_mvp.paddle_subscriptions ps where ps.user_id=u.id and ps.environment='live')
          or exists(select 1 from shorts_mvp.video_jobs j where j.user_id=u.id and j.output_language in ('en','ja'))
          or exists(select 1 from shorts_mvp.customer_inquiries i where i.user_id=u.id and i.locale in ('en','ja'))
        )
        and not exists(select 1 from shorts_mvp.billing_orders o where o.user_id=u.id and coalesce(o.provider,'')<>'paddle')
        and not exists(select 1 from shorts_mvp.billing_payment_methods m where m.user_id=u.id and coalesce(m.provider,'')<>'paddle')
        and not exists(select 1 from shorts_mvp.user_subscriptions s where s.user_id=u.id and coalesce(s.payment_provider,'')<>'paddle')
        and not exists(select 1 from shorts_mvp.video_jobs j where j.user_id=u.id
          and (coalesce(j.output_language,'ko') not in ('en','ja') or coalesce(j.video_title,'') ~ ${korean}))
        and not exists(select 1 from shorts_mvp.customer_inquiries i
          where (i.user_id=u.id or lower(i.contact_email)=lower(u.email))
            and (coalesce(i.locale,'ko') not in ('en','ja') or i.message ~ ${korean}
              or coalesce(i.page_path,'') ~ '(^/ko(/|$)|[가-힣])'))
        and not exists(select 1 from shorts_mvp.project_feedback_responses f where f.user_id=u.id and coalesce(f.improvement_text,'') ~ ${korean})
        and not exists(select 1 from shorts_mvp.subscription_cancellation_feedback f where f.user_id=u.id
          and concat_ws(' ',f.detail,f.message,f.alternative_service) ~ ${korean})
    ), paid as materialized (
      select p.*,least(p.amount_minor,coalesce(a.refunded,0)) as refunded,
        least(greatest(0,p.amount_minor-coalesce(a.refunded,0)),coalesce(a.chargeback,0)) as chargeback,
        coalesce(a.pending,0) as pending
      from shorts_mvp.paddle_payments p
      join eligible u on u.id=p.user_id
      join shorts_mvp.paddle_subscriptions ps on ps.paddle_id=p.paddle_subscription_id and ps.user_id=p.user_id and ps.environment='live'
      left join lateral (
        select sum(amount_minor) filter(where action='refund' and status='approved') as refunded,
          sum(amount_minor) filter(where action='chargeback' and status='approved') as chargeback,
          sum(amount_minor) filter(where action='refund' and status='pending_approval') as pending
        from shorts_mvp.paddle_adjustments where transaction_id=p.transaction_id
      ) a on true
      where p.currency in ('USD','JPY')
    )
  `;
  const summary = await db`
    with ${scope}
    select
      (select count(*)::int from eligible) as members,
      (select count(*)::int from shorts_mvp.paddle_subscriptions ps join eligible u on u.id=ps.user_id
        where ps.environment='live' and ps.provider_status in ('active','trialing')) as active_subscriptions,
      (select count(*)::int from shorts_mvp.video_jobs j join eligible u on u.id=j.user_id) as projects,
      (select count(*)::int from shorts_mvp.video_jobs j join eligible u on u.id=j.user_id
        where j.created_at >= now()-interval '7 days') as recent_projects,
      (select coalesce(jsonb_agg(t),'[]'::jsonb) from (
        select currency,sum(amount_minor)::bigint as gross,sum(refunded)::bigint as refunded,
          sum(chargeback)::bigint as chargeback,sum(pending)::bigint as pending,count(*)::int as orders,
          coalesce(sum(amount_minor) filter(where (created_at at time zone 'Asia/Seoul')::date=(now() at time zone 'Asia/Seoul')::date),0)::bigint as today
        from paid group by currency order by currency
      ) t) as sales,
      (select jsonb_agg(t order by t.date) from (
        select to_char(d,'YYYY-MM-DD') as date,
          (select count(*)::int from eligible where (created_at at time zone 'Asia/Seoul')::date=d::date) as members,
          (select count(*)::int from shorts_mvp.video_jobs j join eligible u on u.id=j.user_id where (j.created_at at time zone 'Asia/Seoul')::date=d::date) as projects
        from generate_series((now() at time zone 'Asia/Seoul')::date-13,(now() at time zone 'Asia/Seoul')::date,interval '1 day') d
      ) t) as activity
  `;
  // Query only the selected tab; never serialize unrelated or excluded records.
  const source = filters.tab === "billing" ? db`
    select p.transaction_id as id,u.email,u.display_name as name,p.plan_code as label,
      case when p.refunded>=p.amount_minor then 'refunded' else 'completed' end as status,
      p.created_at,p.currency,p.amount_minor as amount
    from paid p join eligible u on u.id=p.user_id
  ` : filters.tab === "projects" ? db`
    select j.id::text,u.email,u.display_name as name,j.video_title as label,j.status,j.created_at,
      null::text as currency,null::bigint as amount
    from shorts_mvp.video_jobs j join eligible u on u.id=j.user_id
  ` : db`
    select u.id::text,u.email,u.display_name as name,'해외 이용 확인'::text as label,
      'member'::text as status,u.created_at,null::text as currency,null::bigint as amount from eligible u
  `;
  const result = await db`
    with ${scope}, records as (${source}), filtered as materialized (
      select * from records where (${filters.query}='' or email ilike ${pattern}
        or name ilike ${pattern} or label ilike ${pattern} or id=${filters.query})
    ), total as (select count(*)::int as count from filtered), paging as (
      select count,greatest(1,ceil(count::numeric/${overseasPageSize})::int) as pages from total
    )
    select count,pages,least(${filters.page},pages) as page,
      (select coalesce(jsonb_agg(t order by t."createdAt" desc,t.id desc),'[]'::jsonb) from (
        select id,email,name,label,status,created_at as "createdAt",currency,amount
        from filtered order by created_at desc,id desc limit ${overseasPageSize}
        offset ((least(${filters.page},pages)-1)*${overseasPageSize})
      ) t) as rows from paging
  `;
  const s = summary[0], r = result[0];
  return {
    filters: {...filters,page:Number(r.page)}, total:Number(r.count),pages:Number(r.pages),rows:r.rows,
    metrics:{members:Number(s.members),activeSubscriptions:Number(s.activeSubscriptions),projects:Number(s.projects),recentProjects:Number(s.recentProjects)},
    sales: (["USD","JPY"] as const).map(currency => {
      const value = (s.sales as OverseasData["sales"]).find(row => row.currency===currency);
      return {currency,gross:Number(value?.gross||0),refunded:Number(value?.refunded||0),chargeback:Number(value?.chargeback||0),pending:Number(value?.pending||0),today:Number(value?.today||0),orders:Number(value?.orders||0)};
    }), activity:s.activity,
  };
}
