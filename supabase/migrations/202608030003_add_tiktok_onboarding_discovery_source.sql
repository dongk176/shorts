begin;

alter table shorts_mvp.user_onboarding_profiles
  drop constraint if exists user_onboarding_profiles_discovery_source_check;

alter table shorts_mvp.user_onboarding_profiles
  add constraint user_onboarding_profiles_discovery_source_check
    check (
      discovery_source is null
      or discovery_source in (
        'instagram',
        'youtube',
        'tiktok',
        'friend_referral',
        'direct_search',
        'blog_community',
        'other'
      )
    );

commit;
