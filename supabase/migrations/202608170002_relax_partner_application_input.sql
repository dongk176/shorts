begin;

alter table shorts_mvp.partner_applications
  drop constraint if exists partner_applications_promotion_plan_check;
alter table shorts_mvp.partner_applications
  add constraint partner_applications_promotion_plan_check
  check (char_length(promotion_plan) between 5 and 1000);

commit;
