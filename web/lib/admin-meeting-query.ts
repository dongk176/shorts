// Static, parameterized, read-only SQL. Never interpolate request text here.
export const meetingQuery = `
with language as materialized (
 select distinct on (user_id) user_id, locale
 from shorts_mvp.conversion_events
 where environment='production' and user_id is not null and locale in ('ko','ja','en')
 order by user_id,received_at,id
), people as materialized (
 select u.id,u.created_at,u.withdrawn_at,coalesce(l.locale,'unknown') as locale
 from shorts_mvp.app_users u left join language l on l.user_id=u.id
), selected as materialized (
 select * from people where $3='all' or locale=$3
), subs as materialized (
 select s.* from shorts_mvp.user_subscriptions s join selected u on u.id=s.user_id
 where s.payment_provider in ('toss','thepayone','nicepay')
 or (s.payment_provider='paddle' and exists(select 1 from shorts_mvp.paddle_subscriptions p where p.subscription_id=s.id and p.environment='live'))
 or (s.payment_provider='paypal' and (exists(select 1 from shorts_mvp.paypal_subscriptions p where p.subscription_id=s.id and p.environment='live') or exists(select 1 from shorts_mvp.paypal_one_time_orders p where p.subscription_id=s.id and p.environment='live' and p.paid_at is not null)))
), payments as (
 select o.approved_at as at,'KRW' as currency,o.amount_krw::bigint as gross,o.refunded_amount_krw::bigint as refunded
 from shorts_mvp.billing_orders o join selected u on u.id=o.user_id
 where o.approved_at >= $4::timestamptz and o.approved_at < $2::timestamptz and o.amount_krw>0
 union all
 select p.created_at,p.currency,p.amount_minor,least(p.amount_minor,coalesce(a.amount,0))
 from shorts_mvp.paddle_payments p join selected u on u.id=p.user_id
 join shorts_mvp.paddle_subscriptions s on s.paddle_id=p.paddle_subscription_id and s.environment='live'
 left join lateral(select sum(amount_minor) as amount from shorts_mvp.paddle_adjustments where transaction_id=p.transaction_id and status='approved' and action in ('refund','chargeback'))a on true
 where p.created_at >= $4::timestamptz and p.created_at < $2::timestamptz
 union all
 select p.created_at,p.currency,p.amount_minor,least(p.amount_minor,p.refunded_minor)
 from shorts_mvp.paypal_payments p join selected u on u.id=p.user_id
 join shorts_mvp.paypal_subscriptions s on s.paypal_id=p.paypal_subscription_id and s.environment='live'
 where p.created_at >= $4::timestamptz and p.created_at < $2::timestamptz
 union all
 select p.paid_at,p.currency,p.amount_minor,case when p.reversed then p.amount_minor else least(p.amount_minor,p.refunded_minor) end
 from shorts_mvp.paypal_one_time_orders p join selected u on u.id=p.user_id
 where p.environment='live' and p.paid_at >= $4::timestamptz and p.paid_at < $2::timestamptz
), facts as (
 select created_at as at,'signups' as metric,'' as currency,1::bigint as value from selected
 union all select withdrawn_at,'withdrawals','',1 from selected where withdrawn_at is not null
 union all select completed_at,'onboarding','',1 from shorts_mvp.user_onboarding_profiles p join selected u on u.id=p.user_id
 union all select created_at,'subscriptions','',1 from subs
 union all select canceled_at,'cancellations','',1 from subs where canceled_at is not null
 union all select ended_at,'ended','',1 from subs where ended_at is not null
 union all select j.created_at,'projects','',1 from shorts_mvp.video_jobs j join selected u on u.id=j.user_id where not j.is_example
 union all select j.completed_at,'completedProjects','',1 from shorts_mvp.video_jobs j join selected u on u.id=j.user_id where not j.is_example and j.status='completed'
 union all select s.created_at,'shorts','',1 from shorts_mvp.generated_shorts s join selected u on u.id=s.user_id join shorts_mvp.video_jobs j on j.id=s.job_id where not j.is_example and s.output_s3_key is not null and s.file_size_bytes>0
 union all select at,'gross',currency,gross from payments
 union all select at,'refunds',currency,refunded from payments
 union all select at,'payments',currency,1 from payments
), daily as (
 select to_char(at at time zone 'Asia/Seoul','YYYY-MM-DD') as day,metric,currency,sum(value)::float8 as value
 from facts where at >= $4::timestamptz and at < $2::timestamptz group by 1,2,3
), breakdown as (
 select 'occupation' as category,p.occupation as label,count(*)::float8 as value from shorts_mvp.user_onboarding_profiles p join selected u on u.id=p.user_id where p.completed_at >= $1::timestamptz and p.completed_at < $2::timestamptz group by 2
 union all select 'purpose',purpose,count(*) from shorts_mvp.user_onboarding_profiles p join selected u on u.id=p.user_id cross join lateral unnest(p.usage_purposes) purpose where p.completed_at >= $1::timestamptz and p.completed_at < $2::timestamptz group by 2
 union all select 'discovery',coalesce(p.discovery_source,'unknown'),count(*) from shorts_mvp.user_onboarding_profiles p join selected u on u.id=p.user_id where p.completed_at >= $1::timestamptz and p.completed_at < $2::timestamptz group by 2
 union all select 'reason',f.reason,count(*) from shorts_mvp.subscription_cancellation_feedback f join selected u on u.id=f.user_id where f.canceled_at >= $1::timestamptz and f.canceled_at < $2::timestamptz group by 2
 union all select 'outputLanguage',coalesce(j.output_language,'unknown'),count(*) from shorts_mvp.video_jobs j join selected u on u.id=j.user_id where not j.is_example and j.created_at >= $1::timestamptz and j.created_at < $2::timestamptz group by 2
), snapshot as (
 select
 (select count(*) from selected where withdrawn_at is null)::integer as members,
 (select count(*) from selected)::integer as accounts,
 (select count(*) from subs where status='active')::integer as active,
 (select count(*) from subs where status='past_due')::integer as pastDue,
 (select count(*) from subs where status='active' and cancel_at_period_end)::integer as cancelScheduled,
 (select count(*) from shorts_mvp.youtube_account_links y join selected u on u.id=y.user_id where y.status='active')::integer as channels,
 (select count(distinct y.user_id) from shorts_mvp.youtube_account_links y join selected u on u.id=y.user_id where y.status='active')::integer as channelMembers,
 (select count(*) from subs where created_at < $2::timestamptz and (ended_at is null or ended_at >= $1::timestamptz))::integer as exposed,
 (select count(*) from subs where canceled_at >= $1::timestamptz and canceled_at < $2::timestamptz and (ended_at is null or ended_at >= $1::timestamptz))::integer as cancelRequests,
 (select count(*) from subs where created_at < $1::timestamptz and (ended_at is null or ended_at >= $4::timestamptz))::integer as previousExposed,
 (select count(*) from subs where canceled_at >= $4::timestamptz and canceled_at < $1::timestamptz and (ended_at is null or ended_at >= $4::timestamptz))::integer as previousCancelRequests,
 (select count(*) from people)::integer as totalAccounts,
 (select count(*) from people where locale<>'unknown')::integer as classifiedAccounts,
 (select min(received_at) from shorts_mvp.conversion_events where environment='production') as languageSince,
 (select min(canceled_at) from shorts_mvp.subscription_cancellation_feedback) as reasonsSince,
 (select min(created_at) from shorts_mvp.app_users) as membersSince,
 (select min(completed_at) from shorts_mvp.user_onboarding_profiles) as onboardingSince
)
select coalesce((select jsonb_agg(d order by d.day,d.metric,d.currency) from daily d),'[]'::jsonb) as daily,
 coalesce((select jsonb_agg(b order by b.category,b.value desc) from breakdown b),'[]'::jsonb) as breakdown,
 (select row_to_json(s) from snapshot s) as snapshot
`;
