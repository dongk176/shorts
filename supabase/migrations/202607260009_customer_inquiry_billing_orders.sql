begin;

alter table shorts_mvp.customer_inquiries
  add column if not exists inquiry_kind text not null default 'general',
  add column if not exists billing_order_id uuid
    references shorts_mvp.billing_orders(id) on delete restrict,
  add column if not exists refund_reason_code text;

alter table shorts_mvp.customer_inquiries
  drop constraint if exists customer_inquiries_inquiry_kind_check,
  drop constraint if exists customer_inquiries_refund_reason_code_check,
  drop constraint if exists customer_inquiries_refund_request_fields_check;

alter table shorts_mvp.customer_inquiries
  add constraint customer_inquiries_inquiry_kind_check
    check (inquiry_kind in ('general','refund_request')),
  add constraint customer_inquiries_refund_reason_code_check
    check (
      refund_reason_code is null or refund_reason_code in (
        'unused_or_changed_mind',
        'duplicate_payment',
        'service_issue',
        'billing_error',
        'other'
      )
    ),
  add constraint customer_inquiries_refund_request_fields_check
    check (
      (
        inquiry_kind='refund_request'
        and category='billing_refund'
        and billing_order_id is not null
        and refund_reason_code is not null
      )
      or (
        inquiry_kind='general'
        and billing_order_id is null
        and refund_reason_code is null
      )
    );

create index if not exists customer_inquiries_billing_order_created_idx
  on shorts_mvp.customer_inquiries (billing_order_id,created_at desc)
  where billing_order_id is not null;
create unique index if not exists customer_inquiries_one_open_refund_request_idx
  on shorts_mvp.customer_inquiries (billing_order_id)
  where inquiry_kind='refund_request'
    and status in ('new','in_progress','waiting_on_customer');

comment on column shorts_mvp.customer_inquiries.inquiry_kind is
  'General support inquiry or a refund request tied to a verified customer billing order.';
comment on column shorts_mvp.customer_inquiries.billing_order_id is
  'Server-verified order selected by the customer for a refund request.';
comment on column shorts_mvp.customer_inquiries.refund_reason_code is
  'Customer-selected reason for a refund request. It does not determine eligibility or refund amount.';

commit;
