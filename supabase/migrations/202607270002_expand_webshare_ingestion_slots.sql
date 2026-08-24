begin;

insert into shorts_mvp.ingestion_route_slots (route_id,egress_class,enabled)
select 'webshare-' || lpad(value::text,2,'0'), 'webshare_isp', false
from generate_series(11,20) value
on conflict (route_id) do nothing;

commit;
