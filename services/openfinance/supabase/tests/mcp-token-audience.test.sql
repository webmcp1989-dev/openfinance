begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);
select has_function('public', 'custom_access_token_hook', array['jsonb'], 'custom access token hook exists');
select ok(has_schema_privilege('supabase_auth_admin', 'public', 'usage'), 'Supabase Auth can resolve the hook schema');
select ok(has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute'), 'Supabase Auth can invoke the token hook');
select ok(not has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'execute'), 'application users cannot invoke the token hook');
select is(
  public.custom_access_token_hook('{"claims":{"aud":"authenticated","client_id":"oauth-client","role":"authenticated"}}'::jsonb) -> 'claims' ->> 'aud',
  'https://openfinance-ar.vercel.app/mcp',
  'OAuth access tokens are bound to the exact MCP resource'
);
select is(
  public.custom_access_token_hook('{"claims":{"aud":"authenticated","role":"authenticated"}}'::jsonb) -> 'claims' ->> 'aud',
  'authenticated',
  'normal portal tokens retain the Supabase audience'
);

select * from finish();
rollback;
