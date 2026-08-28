# OpenFinance

OpenFinance is a WebMCP Challenge project demonstrating agent-mediated interoperability between two independently authenticated B2B finance applications.

```text
OpenFinance AR <-> WebMCP <-> ChatGPT browser agent + human <-> WebMCP <-> Acme AP
```

There is no point-to-point integration or shared credential relationship between the applications. The browser agent works through each application's independently authenticated WebMCP tools, with the human retaining control over consequential actions.

## Repository layout

- `apps/openfinance-ar`: seller-side AR application, deployed as its own Vercel project.
- `apps/acme-ap`: customer-side AP supplier portal, deployed as its own Vercel project.
- `services/openfinance`: OpenFinance migrations, Edge Functions, tests, and operational documentation for an independent Supabase project.
- `services/acme`: Acme migrations, Edge Functions, tests, and operational documentation for a second independent Supabase project.
- `docs`: product, architecture, security, WebMCP, API, and challenge documentation.

## Status

The project foundation and architecture are being established. Functional setup instructions will be added with the first runnable vertical slice.

## Documentation

- [Challenge north star](docs/NORTH_STAR.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [WebMCP design](docs/WEBMCP.md)
- [Architecture decisions](docs/decisions/0001-independent-applications.md)

## License

An open-source license will be selected and added before the first public release. No rights are granted until that license file is present.
