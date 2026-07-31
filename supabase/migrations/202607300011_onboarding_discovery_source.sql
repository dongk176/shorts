begin;

alter table shorts_mvp.user_onboarding_profiles
  add column if not exists discovery_source text,
  add column if not exists discovery_source_other text;

alter table shorts_mvp.user_onboarding_profiles
  drop constraint if exists user_onboarding_profiles_onboarding_version_check,
  drop constraint if exists user_onboarding_profiles_discovery_source_check,
  drop constraint if exists user_onboarding_profiles_discovery_source_other_length_check,
  drop constraint if exists user_onboarding_profiles_discovery_source_pair_check,
  drop constraint if exists user_onboarding_profiles_discovery_source_version_check;

alter table shorts_mvp.user_onboarding_profiles
  alter column onboarding_version set default 2,
  add constraint user_onboarding_profiles_onboarding_version_check
    check (onboarding_version in (1,2)),
  add constraint user_onboarding_profiles_discovery_source_check
    check (
      discovery_source is null
      or discovery_source in (
        'instagram',
        'youtube',
        'friend_referral',
        'direct_search',
        'blog_community',
        'other'
      )
    ),
  add constraint user_onboarding_profiles_discovery_source_other_length_check
    check (
      discovery_source_other is null
      or char_length(discovery_source_other) between 1 and 100
    ),
  add constraint user_onboarding_profiles_discovery_source_pair_check
    check (
      (discovery_source is null and discovery_source_other is null)
      or (discovery_source='other' and discovery_source_other is not null)
      or (
        discovery_source is not null
        and discovery_source<>'other'
        and discovery_source_other is null
      )
    ),
  add constraint user_onboarding_profiles_discovery_source_version_check
    check (
      (onboarding_version=1 and discovery_source is null)
      or onboarding_version=2
    );

comment on column shorts_mvp.user_onboarding_profiles.discovery_source is
  'Single-select acquisition source captured by onboarding v2. Null is retained only for v2 responses saved before this field existed.';
comment on column shorts_mvp.user_onboarding_profiles.discovery_source_other is
  'Free-text acquisition source when discovery_source is other.';

commit;
