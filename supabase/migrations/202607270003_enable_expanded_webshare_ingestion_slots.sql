begin;

update shorts_mvp.ingestion_route_slots
set enabled=true,
    updated_at=clock_timestamp()
where route_id between 'webshare-11' and 'webshare-20'
  and egress_class='webshare_isp';

commit;
