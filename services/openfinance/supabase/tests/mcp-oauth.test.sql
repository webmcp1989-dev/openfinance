begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(10);
select has_function('private', 'annotate_audit_actor', array[]::text[], 'audit actor annotation function exists');
select has_trigger('public', 'audit_events', 'annotate_audit_actor_before_insert', 'audit actor annotation trigger exists');
select ok(not has_function_privilege('authenticated', 'private.reset_demo_state()', 'execute'), 'OAuth-capable authenticated role cannot execute private reset directly');
select ok((select prosecdef from pg_proc where oid = 'public.reset_demo_state()'::regprocedure), 'public reset wrapper enforces the human-only rule as security definer');

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select id::text from auth.users where lower(email) = 'demo@openfinance.dev'),
    'role', 'authenticated',
    'client_id', '00000000-0000-4000-8000-000000000099'
  )::text,
  true
);
set local role authenticated;

select is((public.sync_invoices_from_erp('mcp-oauth-audit-20260829')->>'importedCount'), '2', 'OAuth agent can run an authorized AR sync');
select throws_ok(
  $$ select public.reset_demo_state() $$,
  '42501',
  'Demo reset is available only through the human portal',
  'OAuth client cannot invoke the human-only reset'
);
reset role;

select is(
  (select details ->> 'actorChannel' from public.audit_events where action = 'erp_invoice_sync_completed' order by id desc limit 1),
  'oauth_mcp',
  'OAuth mutation is labeled as agent activity'
);
select is(
  (select details ->> 'oauthClientId' from public.audit_events where action = 'erp_invoice_sync_completed' order by id desc limit 1),
  '00000000-0000-4000-8000-000000000099',
  'OAuth client ID is retained in the audit event'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select id::text from auth.users where lower(email) = 'demo@openfinance.dev'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;
select is((public.reset_demo_state()->>'restoredInvoiceCount'), '24', 'human portal operator can still reset the complete portfolio');
reset role;
select is(
  (select details ->> 'actorChannel' from public.audit_events where action = 'demo_state_reset' order by id desc limit 1),
  'human',
  'portal mutation is labeled as human activity'
);

select * from finish();
rollback;
