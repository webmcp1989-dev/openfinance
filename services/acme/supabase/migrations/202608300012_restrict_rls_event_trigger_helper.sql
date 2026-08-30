begin;

-- Supabase installs this event-trigger helper as a SECURITY DEFINER function.
-- Application roles never need to invoke it directly: PostgreSQL executes it as
-- the event trigger owner when DDL creates a public table.
do $$
begin
  if pg_catalog.to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

commit;
