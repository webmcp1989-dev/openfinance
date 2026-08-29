begin;

create function public.custom_access_token_hook(event jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'claims',
    case
      when nullif(event -> 'claims' ->> 'client_id', '') is not null then
        jsonb_set(
          event -> 'claims',
          '{aud}',
          to_jsonb('https://openfinance-ar.vercel.app/mcp'::text),
          false
        )
      else event -> 'claims'
    end
  )
$$;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

commit;
