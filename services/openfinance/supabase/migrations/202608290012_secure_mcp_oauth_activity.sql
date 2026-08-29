begin;

create function private.annotate_audit_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id text := nullif(auth.jwt() ->> 'client_id', '');
begin
  new.details := coalesce(new.details, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'actorChannel', case when v_client_id is null then 'human' else 'oauth_mcp' end,
    'oauthClientId', v_client_id
  ));
  return new;
end;
$$;

revoke execute on function private.annotate_audit_actor() from public, anon, authenticated;

create trigger annotate_audit_actor_before_insert
before insert on public.audit_events
for each row execute function private.annotate_audit_actor();

revoke execute on function private.reset_demo_state() from authenticated;

create or replace function public.reset_demo_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if nullif(auth.jwt() ->> 'client_id', '') is not null then
    raise exception using errcode = '42501', message = 'Demo reset is available only through the human portal';
  end if;

  return private.reset_demo_state();
end;
$$;

revoke execute on function public.reset_demo_state() from public, anon;
grant execute on function public.reset_demo_state() to authenticated;

commit;
