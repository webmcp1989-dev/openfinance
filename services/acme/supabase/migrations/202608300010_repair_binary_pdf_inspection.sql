begin;

-- PostgreSQL has no bytea replace(bytea, bytea, bytea) overload. Encode the
-- complete binary as escaped text instead: printable PDF structure remains
-- searchable and every non-text byte is represented safely.
create or replace function private.is_structurally_valid_pdf(p_bytes bytea)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  v_hex text;
  v_text text;
  v_match text[];
  v_offset integer;
begin
  v_text := pg_catalog.encode(p_bytes, 'escape');
  if pg_catalog.octet_length(p_bytes) < 10
     or pg_catalog.substr(p_bytes, 1, 5) <> pg_catalog.convert_to('%PDF-', 'UTF8')
     or v_text !~ '/Type[[:space:]]*/Catalog([^[:alnum:]_]|$)'
     or v_text !~ '/Type[[:space:]]*/Page([^[:alnum:]_]|$)' then
    return false;
  end if;

  v_hex := pg_catalog.encode(p_bytes, 'hex');
  v_match := pg_catalog.regexp_match(
    v_hex,
    '737461727478726566(?:09|0a|0c|0d|20)+((?:3[0-9]){1,7})(?:09|0a|0c|0d|20)+2525454f46(?:09|0a|0c|0d|20)*$'
  );
  if v_match is null then return false; end if;

  v_offset := pg_catalog.convert_from(pg_catalog.decode(v_match[1], 'hex'), 'UTF8')::integer;
  return v_offset >= 0
    and v_offset + 4 <= pg_catalog.octet_length(p_bytes)
    and pg_catalog.substr(p_bytes, v_offset + 1, 4) = pg_catalog.convert_to('xref', 'UTF8');
end;
$$;

revoke execute on function private.is_structurally_valid_pdf(bytea) from public, anon;
grant execute on function private.is_structurally_valid_pdf(bytea) to authenticated;

commit;
