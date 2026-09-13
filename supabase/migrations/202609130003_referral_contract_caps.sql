begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Additive rollout: unverified historical rows cannot be paid by an older web
-- deployment while the explicit, audited reconciliation is being performed.
alter table shorts_mvp.referral_commissions
  add column if not exists original_contract jsonb not null default '{}'::jsonb,
  add column if not exists eligible_installment_count integer not null default 0,
  add column if not exists recognition_status text not null default 'review_required',
  add column if not exists recognition_reason text,
  add column if not exists recognition_evidence jsonb not null default '{}'::jsonb,
  add column if not exists commission_basis_krw integer not null default 0,
  add column if not exists excluded_sales_krw integer not null default 0;
alter table shorts_mvp.referral_commissions
  add constraint referral_contract_status_check check (recognition_status in ('verified','review_required')),
  add constraint referral_contract_eligible_check check (eligible_installment_count between 0 and recognition_months),
  add constraint referral_contract_basis_check check (commission_basis_krw>=0 and excluded_sales_krw>=0);

create or replace function shorts_mvp.referral_recognition_months(p_product_code text,p_billing_cycle text)
returns integer language sql stable security definer set search_path=pg_catalog,shorts_mvp as $$
  select case when prepaid_months between 1 and 12 then
    case when p_product_code like 'toss_%' or p_billing_cycle='yearly' then prepaid_months else 1 end
  end from shorts_mvp.plans where code=p_product_code;
$$;

-- Only SELECTs: used by previews and guards as well as the materializer.
create or replace function shorts_mvp.referral_contract_state(p_commission_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,shorts_mvp as $$
declare c record; o jsonb; event record; target_code text; target_months integer;
  retained integer; expected_refund integer; end_value timestamptz; k integer;
  reason text; evidence jsonb := '{}'::jsonb; event_found boolean := false;
begin
  select * into c from shorts_mvp.referral_commissions where id=p_commission_id;
  select to_jsonb(b) into o from shorts_mvp.billing_orders b where b.id=c.billing_order_id;
  retained := c.recognition_months;
  if c.original_contract->>'verified' is distinct from 'true' then reason := 'original_contract_unverified'; end if;
  if (c.original_contract->>'amountKrw')::integer is distinct from c.gross_amount_krw
    or (c.original_contract->>'commissionRateBps')::integer is distinct from c.commission_rate_bps
    then reason := 'original_contract_changed'; end if;

  if to_regclass('shorts_mvp.admin_audit_logs') is not null then
    for event in
      select a.id,a.action,a.metadata,a.created_at from shorts_mvp.admin_audit_logs a
      where a.action in ('subscription.plan_manually_converted','subscription.support_plan_conversion',
        'subscription.support_refund_service_change','billing.external_refund_reconciled')
        and a.created_at >= (c.original_contract->>'approvedAt')::timestamptz
        and (
          a.entity_id::text=c.billing_order_id::text
          or a.metadata->>'orderId' in (c.billing_order_id::text,o->>'order_id')
          or a.metadata->>'publicOrderId'=o->>'order_id'
          or (a.entity_id::text=o->>'subscription_id' and not exists (
            select 1 from shorts_mvp.billing_orders newer
            where to_jsonb(newer)->>'subscription_id'=o->>'subscription_id'
              and newer.approved_at>(c.original_contract->>'approvedAt')::timestamptz
              and newer.approved_at<=a.created_at and newer.id<>c.billing_order_id
          ))
        )
        and coalesce(a.metadata->>'targetPlanCode',a.metadata->>'newPlanCode') is not null
      order by a.created_at desc,a.id desc limit 1
    loop
      event_found := true;
      target_code := coalesce(event.metadata->>'targetPlanCode',event.metadata->>'newPlanCode');
      select prepaid_months into target_months from shorts_mvp.plans where code=target_code;
      evidence := jsonb_build_object('auditId',event.id,'action',event.action,'targetProductCode',target_code);
      if target_months is null or target_months not between 1 and 12 then
        reason := 'conversion_period_unverified';
      else
        retained := least(c.recognition_months,target_months);
        end_value := nullif(coalesce(event.metadata->>'newPeriodEnd',event.metadata->>'entitlementEndAt'),'')::timestamptz;
        if end_value is not null then
          retained := null;
          for k in 1..c.recognition_months loop
            if abs(extract(epoch from (end_value-shorts_mvp.referral_add_kst_months(
              (c.original_contract->>'approvedAt')::timestamptz,k)))) <= 300 then retained:=k; exit; end if;
          end loop;
          if retained is null then reason := 'conversion_end_unverified'; retained:=0; end if;
        elsif event.created_at>=shorts_mvp.referral_add_kst_months((c.original_contract->>'approvedAt')::timestamptz,1) then
          reason := 'conversion_end_unverified';
        end if;
      end if;
      expected_refund := coalesce(
        nullif(event.metadata->>'expectedPartialRefundKrw','')::integer,
        nullif(event.metadata->>'plannedRefundKrw','')::integer,
        nullif(event.metadata->>'refundAmountKrw','')::integer,
        c.gross_amount_krw-nullif(event.metadata->>'retainedAmountKrw','')::integer
      );
      if expected_refund is null then reason := 'conversion_refund_unverified';
      elsif expected_refund not between 0 and c.gross_amount_krw
        or (event.metadata->>'retainedAmountKrw' is not null and
          (event.metadata->>'retainedAmountKrw')::integer<>c.gross_amount_krw-expected_refund)
        or (event.metadata->>'targetContractMonths' is not null and
          (event.metadata->>'targetContractMonths')::integer is distinct from target_months)
        then reason := 'conversion_evidence_invalid';
      elsif c.refunded_amount_krw<expected_refund then reason := 'conversion_refund_pending'; end if;
      evidence := evidence||jsonb_build_object('expectedRefundKrw',expected_refund,'eligibleInstallmentCount',retained);
    end loop;
  end if;
  if not event_found and o->>'product_code' is distinct from c.original_contract->>'productCode' then
    reason := 'conversion_evidence_missing';
  end if;
  -- A completed full refund has no outstanding entitlement, even when the
  -- intermediate support conversion was unresolved. Preserve its evidence.
  if c.refunded_amount_krw=c.gross_amount_krw and c.gross_amount_krw>0
    and c.original_contract->>'verified'='true' then retained:=0; reason:=null; end if;
  return jsonb_build_object('status',case when reason is null then 'verified' else 'review_required' end,
    'reason',reason,'eligibleInstallmentCount',coalesce(retained,0),'evidence',evidence);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return jsonb_build_object('status','review_required','reason','conversion_evidence_invalid',
    'eligibleInstallmentCount',0,'evidence',evidence);
end;
$$;

create or replace function shorts_mvp.rebuild_referral_commission_installments(p_commission_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,shorts_mvp as $$
declare c record; state jsonb; n integer; eligible integer; base integer; cap integer; net integer;
  idx integer; before_gross integer; gross integer; after_gross integer; before_net integer; after_net integer;
  earned timestamptz; previous_total integer; total integer;
begin
  select * into c from shorts_mvp.referral_commissions where id=p_commission_id for update;
  if not found then return; end if;
  state := shorts_mvp.referral_contract_state(c.id);
  n:=c.recognition_months; eligible:=(state->>'eligibleInstallmentCount')::integer;
  base:=c.gross_amount_krw/n;
  cap:=case when eligible=n then c.gross_amount_krw else base*eligible end;
  net:=least(greatest(c.gross_amount_krw-c.refunded_amount_krw,0),cap);
  if state->>'status'<>'verified' then net:=0; end if;
  previous_total:=c.commission_amount_krw;
  total:=floor(net::numeric*c.commission_rate_bps/10000)::integer;
  for idx in 1..n loop
    before_gross:=base*(idx-1);
    gross:=case when idx=n then c.gross_amount_krw-before_gross else base end;
    after_gross:=before_gross+gross;
    before_net:=least(net,before_gross); after_net:=least(net,after_gross);
    earned:=shorts_mvp.referral_add_kst_months((c.original_contract->>'approvedAt')::timestamptz,idx-1);
    insert into shorts_mvp.referral_commission_installments(
      commission_id,installment_number,installment_count,gross_amount_krw,recognized_amount_krw,
      scheduled_commission_amount_krw,commission_amount_krw,earned_at,available_at
    ) values(c.id,idx,n,gross,after_net-before_net,
      floor(after_gross::numeric*c.commission_rate_bps/10000)-floor(before_gross::numeric*c.commission_rate_bps/10000),
      floor(after_net::numeric*c.commission_rate_bps/10000)-floor(before_net::numeric*c.commission_rate_bps/10000),
      earned,earned+interval '7 days')
    on conflict(commission_id,installment_number) do update set
      installment_count=excluded.installment_count,gross_amount_krw=excluded.gross_amount_krw,
      recognized_amount_krw=excluded.recognized_amount_krw,
      scheduled_commission_amount_krw=excluded.scheduled_commission_amount_krw,
      commission_amount_krw=excluded.commission_amount_krw,earned_at=excluded.earned_at,available_at=excluded.available_at;
  end loop;
  -- No deletion: historical identifiers and all cash allocations survive.
  update shorts_mvp.referral_commission_installments set recognized_amount_krw=0,commission_amount_krw=0
    where commission_id=c.id and installment_number>n;
  update shorts_mvp.referral_commissions set
    eligible_installment_count=eligible,recognition_status=state->>'status',recognition_reason=state->>'reason',
    recognition_evidence=state->'evidence',commission_basis_krw=net,
    excluded_sales_krw=case when state->>'status'='verified' then greatest(c.gross_amount_krw-c.refunded_amount_krw-net,0) else 0 end,
    commission_amount_krw=total
    where id=c.id;
  if total<>previous_total then
    insert into shorts_mvp.referral_commission_events(commission_id,event_kind,amount_delta_krw,target_commission_krw,source_refunded_amount_krw)
    values(c.id,case when total<previous_total then 'refund_adjustment' else 'correction' end,total-previous_total,total,c.refunded_amount_krw)
    on conflict do nothing;
  end if;
end;
$$;

create or replace function shorts_mvp.initialize_referral_contract(p_commission_id uuid,p_historical boolean default false)
returns void language plpgsql security definer set search_path=pg_catalog,shorts_mvp as $$
declare c record; o jsonb; product text; months integer; source_id text; source_kind text := 'approved_order';
  verified boolean := true; candidates integer;
begin
  select * into c from shorts_mvp.referral_commissions where id=p_commission_id for update;
  if not found then return; end if;
  if c.original_contract<>'{}'::jsonb then perform shorts_mvp.rebuild_referral_commission_installments(c.id); return; end if;
  select to_jsonb(b) into o from shorts_mvp.billing_orders b where b.id=c.billing_order_id;
  product:=o->>'product_code'; source_id:=c.billing_order_id::text;
  if p_historical and o->>'provider'='toss' and o->>'kind'='subscription_initial' then
    verified:=false;
    if to_regclass('shorts_mvp.billing_toss_checkout_intents') is not null then
      select count(distinct it.target_plan_code),min(it.target_plan_code),min(it.id::text)
      into candidates,product,source_id from shorts_mvp.billing_toss_checkout_intents it
      where it.subscription_id::text=o->>'subscription_id' and it.purpose='subscription_start'
        and it.status='succeeded' and it.created_at<=(o->>'approved_at')::timestamptz;
      verified:=candidates=1; source_kind:='checkout_intent';
    end if;
  end if;
  months:=shorts_mvp.referral_recognition_months(product,o->>'billing_cycle');
  verified:=verified and months is not null;
  update shorts_mvp.referral_commissions set recognition_months=coalesce(months,1),eligible_installment_count=0,
    original_contract=jsonb_build_object('version',1,'productCode',product,'months',months,
      'amountKrw',c.gross_amount_krw,'commissionRateBps',c.commission_rate_bps,'approvedAt',o->>'approved_at',
      'source',source_kind,'sourceId',source_id,'verified',verified)
    where id=c.id;
  perform shorts_mvp.rebuild_referral_commission_installments(c.id);
end;
$$;

create or replace function shorts_mvp.sync_referral_commission()
returns trigger language plpgsql security definer set search_path=pg_catalog,shorts_mvp as $$
declare c record; partner record; cid uuid;
begin
  select * into c from shorts_mvp.referral_commissions where billing_order_id=new.id for update;
  if found then
    update shorts_mvp.referral_commissions set gross_amount_krw=new.amount_krw,
      refunded_amount_krw=new.refunded_amount_krw where id=c.id;
    perform shorts_mvp.initialize_referral_contract(c.id);
    return new;
  end if;
  if new.amount_krw<=0 or new.status<>'succeeded' or new.approved_at is null then return new; end if;
  select p.* into partner from shorts_mvp.app_users u join shorts_mvp.referral_partners p on p.id=u.referral_partner_id
    where u.id=new.user_id and (p.status<>'terminated' or p.terminated_at is null or new.approved_at<p.terminated_at);
  if not found then return new; end if;
  insert into shorts_mvp.referral_commissions(billing_order_id,partner_id,user_id,commission_rate_bps,
    gross_amount_krw,refunded_amount_krw,commission_amount_krw,available_at,recognition_months)
    values(new.id,partner.id,new.user_id,partner.commission_rate_bps,new.amount_krw,new.refunded_amount_krw,
      0,new.approved_at+interval '7 days',1)
    on conflict(billing_order_id) do nothing returning id into cid;
  if cid is not null then perform shorts_mvp.initialize_referral_contract(cid); end if;
  return new;
end;
$$;

drop trigger if exists billing_orders_referral_commission_update on shorts_mvp.billing_orders;
create trigger billing_orders_referral_commission_update
after update of status,amount_krw,refunded_amount_krw,approved_at,user_id,product_code,billing_cycle
on shorts_mvp.billing_orders for each row execute function shorts_mvp.sync_referral_commission();

create or replace function shorts_mvp.referral_conversion_audit_changed()
returns trigger language plpgsql security definer set search_path=pg_catalog,shorts_mvp as $$
declare c record;
begin
  if new.action not in ('subscription.plan_manually_converted','subscription.support_plan_conversion',
    'subscription.support_refund_service_change','billing.external_refund_reconciled') then return new; end if;
  for c in select r.id from shorts_mvp.referral_commissions r join shorts_mvp.billing_orders o on o.id=r.billing_order_id
    where new.entity_id::text in (r.billing_order_id::text,to_jsonb(o)->>'subscription_id')
      or new.metadata->>'orderId' in (r.billing_order_id::text,to_jsonb(o)->>'order_id')
      or new.metadata->>'publicOrderId'=to_jsonb(o)->>'order_id'
    order by r.id
  loop perform shorts_mvp.initialize_referral_contract(c.id); end loop;
  return new;
end;
$$;
do $$ begin
  if to_regclass('shorts_mvp.admin_audit_logs') is not null then
    create trigger admin_audit_referral_contract_changed after insert or update of metadata on shorts_mvp.admin_audit_logs
      for each row execute function shorts_mvp.referral_conversion_audit_changed();
  end if;
end $$;

create or replace function shorts_mvp.guard_referral_payout_contract()
returns trigger language plpgsql security definer set search_path=pg_catalog,shorts_mvp as $$
begin
  -- Lock before allocations, matching the web payout service. This also
  -- protects an older deployment from paying during the staged rollout.
  perform id from shorts_mvp.referral_commissions where partner_id=new.partner_id order by id for update;
  if exists(select 1 from shorts_mvp.referral_commissions c where c.partner_id=new.partner_id
    and (c.recognition_status<>'verified' or shorts_mvp.referral_contract_state(c.id)->>'status'<>'verified')) then
    raise exception 'REFERRAL_CONTRACT_REVIEW_REQUIRED' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger referral_payout_contract_guard before insert on shorts_mvp.referral_payouts
  for each row execute function shorts_mvp.guard_referral_payout_contract();

create or replace function shorts_mvp.reconcile_referral_contracts()
returns integer language plpgsql security definer set search_path=pg_catalog,shorts_mvp as $$
declare c record; before_state jsonb; after_state jsonb; changed integer:=0;
begin
  lock table shorts_mvp.referral_payouts in share row exclusive mode;
  if exists(select 1 from shorts_mvp.referral_payouts where status in ('draft','paid')) then
    raise exception 'Reconcile existing cash records before referral contract backfill';
  end if;
  for c in select * from shorts_mvp.referral_commissions order by id for update loop
    before_state:=to_jsonb(c);
    perform shorts_mvp.initialize_referral_contract(c.id,true);
    select to_jsonb(r) into after_state from shorts_mvp.referral_commissions r where id=c.id;
    if (before_state-'updated_at') is distinct from (after_state-'updated_at') then
      insert into shorts_mvp.referral_partner_audit_logs(partner_id,actor_type,action,entity_type,entity_id,metadata)
      values(c.partner_id,'system','referral.contract_cap_reconciled','referral_commission',c.id,
        jsonb_build_object('version',1,'before',before_state-'user_id','after',after_state-'user_id'));
      changed:=changed+1;
    end if;
  end loop;
  return changed;
end;
$$;

revoke all on function shorts_mvp.referral_contract_state(uuid),shorts_mvp.initialize_referral_contract(uuid,boolean),
  shorts_mvp.referral_conversion_audit_changed(),shorts_mvp.guard_referral_payout_contract(),
  shorts_mvp.reconcile_referral_contracts() from public,anon,authenticated;
grant execute on function shorts_mvp.referral_contract_state(uuid),shorts_mvp.initialize_referral_contract(uuid,boolean),
  shorts_mvp.reconcile_referral_contracts() to service_role;
commit;
