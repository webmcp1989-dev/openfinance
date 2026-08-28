# Acme backend

This directory owns Acme's independent Supabase project configuration, database migrations, Edge Functions, database tests, and generated types.

It must never reference OpenFinance's Supabase project, service credentials, database schema, or private API.

Planned structure:

```text
supabase/
  config.toml
  migrations/
  functions/
  tests/
```

The structure will be initialized once Supabase CLI access is configured.
