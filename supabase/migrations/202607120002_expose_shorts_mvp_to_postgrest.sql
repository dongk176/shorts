begin;

-- EventBridge maintenance Lambdas use the service-role REST API for this schema.
-- Table grants and RLS continue to block anon and authenticated clients.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, shorts_mvp';
notify pgrst, 'reload config';

commit;
