begin;

-- Referral earnings for prepaid plans are recognized one service month at a
-- time. Keep the order-level commission as the immutable attribution/rate
-- snapshot and materialize the payable monthly ledger separately.
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table shorts_mvp.referral_commissions
  add column if not exists recognition_months integer;

create or replace function shorts_mvp.referral_recognition_months(
  p_product_code text,
  p_billing_cycle text
)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, shorts_mvp
as $$
  select greatest(
    1,
    least(
      12,
      case
        when p_billing_cycle='yearly' then coalesce((
          select plan.prepaid_months
          from shorts_mvp.plans plan
          where plan.code=p_product_code
          limit 1
        ),1)
        else 1
      end
    )
  )::integer;
$$;

update shorts_mvp.referral_commissions commission
set recognition_months=shorts_mvp.referral_recognition_months(
  orders.product_code,
  orders.billing_cycle
)
from shorts_mvp.billing_orders orders
where orders.id=commission.billing_order_id
  and commission.recognition_months is null;

update shorts_mvp.referral_commissions
set recognition_months=1
where recognition_months is null;

alter table shorts_mvp.referral_commissions
  alter column recognition_months set default 1,
  alter column recognition_months set not null;
alter table shorts_mvp.referral_commissions
  drop constraint if exists referral_commissions_recognition_months_check;
alter table shorts_mvp.referral_commissions
  add constraint referral_commissions_recognition_months_check
  check (recognition_months between 1 and 12);

create table if not exists shorts_mvp.referral_commission_installments (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null
    references shorts_mvp.referral_commissions(id) on delete cascade,
  installment_number integer not null check (installment_number between 1 and 12),
  installment_count integer not null check (installment_count between 1 and 12),
  gross_amount_krw integer not null check (gross_amount_krw >= 0),
  recognized_amount_krw integer not null check (
    recognized_amount_krw >= 0 and recognized_amount_krw <= gross_amount_krw
  ),
  scheduled_commission_amount_krw integer not null check (
    scheduled_commission_amount_krw >= 0
  ),
  commission_amount_krw integer not null check (commission_amount_krw >= 0),
  earned_at timestamptz not null,
  available_at timestamptz not null check (available_at >= earned_at),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (commission_id,installment_number),
  check (installment_number <= installment_count),
  check (commission_amount_krw <= scheduled_commission_amount_krw)
);
create index if not exists referral_commission_installments_earned_idx
  on shorts_mvp.referral_commission_installments (earned_at,commission_id);
create index if not exists referral_commission_installments_available_idx
  on shorts_mvp.referral_commission_installments (available_at,commission_id);

create table if not exists shorts_mvp.referral_payout_items (
  payout_id uuid not null
    references shorts_mvp.referral_payouts(id) on delete cascade,
  installment_id uuid not null
    references shorts_mvp.referral_commission_installments(id) on delete restrict,
  amount_krw integer not null check (amount_krw > 0),
  created_at timestamptz not null default now(),
  primary key (payout_id,installment_id)
);
create index if not exists referral_payout_items_installment_idx
  on shorts_mvp.referral_payout_items (installment_id,payout_id);

create or replace function shorts_mvp.referral_add_kst_months(
  p_value timestamptz,
  p_months integer
)
returns timestamptz
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  with source as (
    select p_value at time zone 'Asia/Seoul' as local_value
  ), target as (
    select
      local_value,
      date_trunc('month',local_value)+make_interval(months=>p_months) as target_month
    from source
  )
  select (
    target_month
    + make_interval(days=>(
      least(
        extract(day from local_value)::integer,
        extract(day from (target_month+interval '1 month - 1 day'))::integer
      )-1
    ))
    + (local_value-date_trunc('day',local_value))
  ) at time zone 'Asia/Seoul'
  from target;
$$;

create or replace function shorts_mvp.rebuild_referral_commission_installments(
  p_commission_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, shorts_mvp
as $$
declare
  commission_row record;
  installment_index integer;
  v_installment_count integer;
  base_gross integer;
  installment_gross integer;
  gross_before integer;
  gross_after integer;
  net_total integer;
  net_before integer;
  net_after integer;
  installment_net integer;
  scheduled_commission integer;
  installment_commission integer;
  installment_earned_at timestamptz;
begin
  select
    commission.*,
    orders.approved_at
  into commission_row
  from shorts_mvp.referral_commissions commission
  join shorts_mvp.billing_orders orders on orders.id=commission.billing_order_id
  where commission.id=p_commission_id
  for update of commission;

  if not found or commission_row.approved_at is null then
    return;
  end if;

  v_installment_count := commission_row.recognition_months;
  base_gross := commission_row.gross_amount_krw/v_installment_count;
  net_total := greatest(
    commission_row.gross_amount_krw-commission_row.refunded_amount_krw,
    0
  );

  for installment_index in 1..v_installment_count loop
    gross_before := base_gross*(installment_index-1);
    installment_gross := case
      when installment_index=v_installment_count
        then commission_row.gross_amount_krw-gross_before
      else base_gross
    end;
    gross_after := gross_before+installment_gross;
    net_before := least(net_total,gross_before);
    net_after := least(net_total,gross_after);
    installment_net := net_after-net_before;
    scheduled_commission := (
      floor(gross_after::numeric*commission_row.commission_rate_bps/10000)
      - floor(gross_before::numeric*commission_row.commission_rate_bps/10000)
    )::integer;
    installment_commission := (
      floor(net_after::numeric*commission_row.commission_rate_bps/10000)
      - floor(net_before::numeric*commission_row.commission_rate_bps/10000)
    )::integer;
    installment_earned_at := shorts_mvp.referral_add_kst_months(
      commission_row.approved_at,
      installment_index-1
    );

    insert into shorts_mvp.referral_commission_installments (
      commission_id,installment_number,installment_count,gross_amount_krw,
      recognized_amount_krw,scheduled_commission_amount_krw,
      commission_amount_krw,earned_at,available_at
    ) values (
      p_commission_id,installment_index,v_installment_count,installment_gross,
      installment_net,scheduled_commission,installment_commission,
      installment_earned_at,installment_earned_at+interval '7 days'
    )
    on conflict (commission_id,installment_number) do update set
      installment_count=excluded.installment_count,
      gross_amount_krw=excluded.gross_amount_krw,
      recognized_amount_krw=excluded.recognized_amount_krw,
      scheduled_commission_amount_krw=excluded.scheduled_commission_amount_krw,
      commission_amount_krw=excluded.commission_amount_krw,
      earned_at=excluded.earned_at,
      available_at=excluded.available_at,
      updated_at=now();
  end loop;

  delete from shorts_mvp.referral_commission_installments
  where commission_id=p_commission_id
    and installment_number>v_installment_count;

  update shorts_mvp.referral_commissions
  set commission_amount_krw=(
      floor(net_total::numeric*commission_row.commission_rate_bps/10000)
    )::integer,
    available_at=commission_row.approved_at+interval '7 days'
  where id=p_commission_id;
end;
$$;

create or replace function shorts_mvp.sync_referral_commission()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, shorts_mvp
as $$
declare
  existing_commission shorts_mvp.referral_commissions%rowtype;
  selected_partner shorts_mvp.referral_partners%rowtype;
  target_commission integer;
  commission_delta integer;
  commission_id uuid;
  recognition_months integer;
begin
  if new.amount_krw <= 0 then
    return new;
  end if;

  select *
  into existing_commission
  from shorts_mvp.referral_commissions
  where billing_order_id=new.id
  for update;

  if found then
    target_commission := floor(
      greatest(new.amount_krw-new.refunded_amount_krw,0)::numeric
      * existing_commission.commission_rate_bps
      / 10000
    )::integer;
    commission_delta := target_commission-existing_commission.commission_amount_krw;
    commission_id := existing_commission.id;

    update shorts_mvp.referral_commissions
    set gross_amount_krw=new.amount_krw,
      refunded_amount_krw=new.refunded_amount_krw,
      commission_amount_krw=target_commission,
      updated_at=now()
    where id=commission_id;

    perform shorts_mvp.rebuild_referral_commission_installments(commission_id);

    if commission_delta <> 0 then
      insert into shorts_mvp.referral_commission_events (
        commission_id,event_kind,amount_delta_krw,target_commission_krw,
        source_refunded_amount_krw
      ) values (
        commission_id,
        case when commission_delta < 0 then 'refund_adjustment' else 'correction' end,
        commission_delta,target_commission,new.refunded_amount_krw
      ) on conflict do nothing;
    end if;
    return new;
  end if;

  if new.status <> 'succeeded' or new.approved_at is null then
    return new;
  end if;

  select partner.*
  into selected_partner
  from shorts_mvp.app_users account
  join shorts_mvp.referral_partners partner
    on partner.id=account.referral_partner_id
  where account.id=new.user_id
    and (
      partner.status <> 'terminated'
      or partner.terminated_at is null
      or new.approved_at < partner.terminated_at
    )
  limit 1;

  if not found then
    return new;
  end if;

  recognition_months := shorts_mvp.referral_recognition_months(
    new.product_code,
    new.billing_cycle
  );
  target_commission := floor(
    greatest(new.amount_krw-new.refunded_amount_krw,0)::numeric
    * selected_partner.commission_rate_bps
    / 10000
  )::integer;

  insert into shorts_mvp.referral_commissions (
    billing_order_id,partner_id,user_id,commission_rate_bps,gross_amount_krw,
    refunded_amount_krw,commission_amount_krw,available_at,recognition_months
  ) values (
    new.id,selected_partner.id,new.user_id,selected_partner.commission_rate_bps,
    new.amount_krw,new.refunded_amount_krw,target_commission,
    new.approved_at+interval '7 days',recognition_months
  )
  on conflict (billing_order_id) do nothing
  returning id into commission_id;

  if commission_id is not null then
    perform shorts_mvp.rebuild_referral_commission_installments(commission_id);
  end if;

  if commission_id is not null and target_commission <> 0 then
    insert into shorts_mvp.referral_commission_events (
      commission_id,event_kind,amount_delta_krw,target_commission_krw,
      source_refunded_amount_krw
    ) values (
      commission_id,'earned',target_commission,target_commission,new.refunded_amount_krw
    ) on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists billing_orders_referral_commission_update
  on shorts_mvp.billing_orders;
create trigger billing_orders_referral_commission_update
after update of status,amount_krw,refunded_amount_krw,approved_at,user_id
on shorts_mvp.billing_orders
for each row execute function shorts_mvp.sync_referral_commission();

-- Materialize monthly rows for every historical attributed payment.
do $$
declare
  commission_row record;
begin
  for commission_row in
    select id from shorts_mvp.referral_commissions order by created_at,id
  loop
    perform shorts_mvp.rebuild_referral_commission_installments(commission_row.id);
  end loop;
end;
$$;

-- Preserve historical paid transfers by assigning their immutable snapshots
-- to the oldest scheduled installments, including future installments when
-- the old implementation paid a prepaid order in full.
do $$
declare
  payout_row record;
  installment_row record;
  remaining integer;
  capacity integer;
  allocated integer;
begin
  for payout_row in
    select payout.id,payout.partner_id,payout.amount_krw
    from shorts_mvp.referral_payouts payout
    where payout.status='paid'
    order by coalesce(payout.paid_at,payout.created_at),payout.created_at,payout.id
  loop
    remaining := payout_row.amount_krw;
    for installment_row in
      select installment.id,
        greatest(
          installment.scheduled_commission_amount_krw-coalesce((
            select sum(item.amount_krw)
            from shorts_mvp.referral_payout_items item
            join shorts_mvp.referral_payouts allocated_payout
              on allocated_payout.id=item.payout_id
            where item.installment_id=installment.id
              and allocated_payout.status='paid'
          ),0),
          0
        )::integer as capacity
      from shorts_mvp.referral_commission_installments installment
      join shorts_mvp.referral_commissions commission
        on commission.id=installment.commission_id
      where commission.partner_id=payout_row.partner_id
      order by installment.earned_at,installment.created_at,installment.id
    loop
      exit when remaining<=0;
      capacity := installment_row.capacity;
      if capacity>0 then
        allocated := least(capacity,remaining);
        insert into shorts_mvp.referral_payout_items (
          payout_id,installment_id,amount_krw
        ) values (
          payout_row.id,installment_row.id,allocated
        ) on conflict (payout_id,installment_id) do nothing;
        remaining := remaining-allocated;
      end if;
    end loop;
    if remaining<>0 then
      raise exception 'Unable to reconcile historical referral payout % (% KRW unallocated)',
        payout_row.id,remaining;
    end if;
  end loop;
end;
$$;

-- Reprice unpaid drafts against the new monthly ledger. Drafts that no longer
-- have a payable balance are canceled; paid transfers are never rewritten.
do $$
declare
  payout_row record;
  installment_row record;
  period_outstanding bigint;
  global_outstanding bigint;
  target_amount integer;
  remaining integer;
  capacity integer;
  allocated integer;
begin
  for payout_row in
    select payout.*
    from shorts_mvp.referral_payouts payout
    where payout.status='draft'
    order by payout.created_at,payout.id
  loop
    select coalesce(sum(greatest(
      installment.commission_amount_krw-coalesce(allocated.amount_krw,0),
      0
    )),0)::bigint
    into period_outstanding
    from shorts_mvp.referral_commission_installments installment
    join shorts_mvp.referral_commissions commission
      on commission.id=installment.commission_id
    left join lateral (
      select sum(item.amount_krw)::bigint as amount_krw
      from shorts_mvp.referral_payout_items item
      join shorts_mvp.referral_payouts active_payout
        on active_payout.id=item.payout_id
      where item.installment_id=installment.id
        and active_payout.status in ('draft','paid')
    ) allocated on true
    where commission.partner_id=payout_row.partner_id
      and installment.available_at<=clock_timestamp()
      and (installment.earned_at at time zone 'Asia/Seoul')::date
        between payout_row.period_start and payout_row.period_end;

    select
      coalesce((
        select sum(installment.commission_amount_krw)
        from shorts_mvp.referral_commission_installments installment
        join shorts_mvp.referral_commissions commission
          on commission.id=installment.commission_id
        where commission.partner_id=payout_row.partner_id
          and installment.available_at<=clock_timestamp()
      ),0)::bigint
      - coalesce((
        select sum(active_payout.amount_krw)
        from shorts_mvp.referral_payouts active_payout
        where active_payout.partner_id=payout_row.partner_id
          and (
            active_payout.status='paid'
            or (
              active_payout.status='draft'
              and exists (
                select 1
                from shorts_mvp.referral_payout_items active_item
                where active_item.payout_id=active_payout.id
              )
            )
          )
          and active_payout.id<>payout_row.id
      ),0)::bigint
    into global_outstanding;

    target_amount := least(
      greatest(period_outstanding,0),
      greatest(global_outstanding,0)
    )::integer;

    if target_amount<=0 then
      update shorts_mvp.referral_payouts
      set status='canceled',amount_krw=0,canceled_at=clock_timestamp()
      where id=payout_row.id;
      insert into shorts_mvp.referral_partner_audit_logs (
        partner_id,actor_type,action,entity_type,entity_id,metadata
      ) values (
        payout_row.partner_id,'system','referral.payout_monthly_migration_canceled',
        'referral_payout',payout_row.id,
        jsonb_build_object('previousAmountKrw',payout_row.amount_krw)
      );
      continue;
    end if;

    update shorts_mvp.referral_payouts
    set amount_krw=target_amount
    where id=payout_row.id;
    remaining := target_amount;

    for installment_row in
      select installment.id,
        greatest(
          installment.commission_amount_krw-coalesce((
            select sum(item.amount_krw)
            from shorts_mvp.referral_payout_items item
            join shorts_mvp.referral_payouts active_payout
              on active_payout.id=item.payout_id
            where item.installment_id=installment.id
              and active_payout.status in ('draft','paid')
          ),0),
          0
        )::integer as capacity
      from shorts_mvp.referral_commission_installments installment
      join shorts_mvp.referral_commissions commission
        on commission.id=installment.commission_id
      where commission.partner_id=payout_row.partner_id
        and installment.available_at<=clock_timestamp()
        and (installment.earned_at at time zone 'Asia/Seoul')::date
          between payout_row.period_start and payout_row.period_end
      order by installment.earned_at,installment.created_at,installment.id
    loop
      exit when remaining<=0;
      capacity := installment_row.capacity;
      if capacity>0 then
        allocated := least(capacity,remaining);
        insert into shorts_mvp.referral_payout_items (
          payout_id,installment_id,amount_krw
        ) values (
          payout_row.id,installment_row.id,allocated
        );
        remaining := remaining-allocated;
      end if;
    end loop;

    if remaining<>0 then
      raise exception 'Unable to reprice referral payout draft % (% KRW unallocated)',
        payout_row.id,remaining;
    end if;

    insert into shorts_mvp.referral_partner_audit_logs (
      partner_id,actor_type,action,entity_type,entity_id,metadata
    ) values (
      payout_row.partner_id,'system','referral.payout_monthly_migration_repriced',
      'referral_payout',payout_row.id,
      jsonb_build_object(
        'previousAmountKrw',payout_row.amount_krw,
        'amountKrw',target_amount
      )
    );
  end loop;
end;
$$;

-- Fail the migration closed if the backfilled order and payout ledgers do not
-- reconcile exactly. The displayed available balance is derived from these
-- two identities after deployment.
do $$
begin
  if exists (
    select 1
    from shorts_mvp.referral_commissions commission
    left join lateral (
      select
        coalesce(sum(installment.gross_amount_krw),0)::bigint as gross_amount_krw,
        coalesce(sum(installment.commission_amount_krw),0)::bigint as commission_amount_krw
      from shorts_mvp.referral_commission_installments installment
      where installment.commission_id=commission.id
    ) ledger on true
    where ledger.gross_amount_krw<>commission.gross_amount_krw
      or ledger.commission_amount_krw<>commission.commission_amount_krw
  ) then
    raise exception 'Referral monthly commission backfill did not reconcile';
  end if;

  if exists (
    select 1
    from shorts_mvp.referral_payouts payout
    left join lateral (
      select coalesce(sum(item.amount_krw),0)::bigint as amount_krw
      from shorts_mvp.referral_payout_items item
      where item.payout_id=payout.id
    ) allocated on true
    where payout.status in ('draft','paid')
      and allocated.amount_krw<>payout.amount_krw
  ) then
    raise exception 'Referral payout item backfill did not reconcile';
  end if;
end;
$$;

alter table shorts_mvp.referral_commission_installments enable row level security;
alter table shorts_mvp.referral_payout_items enable row level security;
revoke all on table shorts_mvp.referral_commission_installments from anon, authenticated;
revoke all on table shorts_mvp.referral_payout_items from anon, authenticated;
grant all on table shorts_mvp.referral_commission_installments to service_role;
grant all on table shorts_mvp.referral_payout_items to service_role;

drop trigger if exists referral_commission_installments_set_updated_at
  on shorts_mvp.referral_commission_installments;
create trigger referral_commission_installments_set_updated_at
before update on shorts_mvp.referral_commission_installments
for each row execute function shorts_mvp.set_updated_at();

revoke all on function shorts_mvp.referral_recognition_months(text,text)
  from public,anon,authenticated;
revoke all on function shorts_mvp.referral_add_kst_months(timestamptz,integer)
  from public,anon,authenticated;
revoke all on function shorts_mvp.rebuild_referral_commission_installments(uuid)
  from public,anon,authenticated;
grant execute on function shorts_mvp.referral_recognition_months(text,text)
  to service_role;
grant execute on function shorts_mvp.referral_add_kst_months(timestamptz,integer)
  to service_role;
grant execute on function shorts_mvp.rebuild_referral_commission_installments(uuid)
  to service_role;

commit;
