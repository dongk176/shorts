begin;

update shorts_mvp.plans
set monthly_price_krw=23655,
    yearly_price_krw=70965,
    updated_at=now()
where code='starter_3m';

commit;
