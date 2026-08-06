# Nistar Backend

NestJS + PostgreSQL (Prisma). Multi-tenant: stores only entity *hashes*
(never raw values), issues per-company/per-employee credentials, and serves
the Connector, Extension, and Admin Console.

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | reserved, not currently used - see "Auth model" below for what's actually in place |
| `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD` | the operator's single account, gating `POST /admin/companies` (creating a new tenant) and its `GET`/`DELETE` by id - known only to the Nistar operator, not customers |
| `PORT` | defaults to 3000 |

## Run

```bash
npm install
npx prisma migrate dev   # applies migrations against DATABASE_URL
npm run start:dev
```

## Test

```bash
npm test           # unit tests
npm run test:e2e   # integration tests against a real Postgres (DATABASE_URL)
```

## Auth model

- `x-admin-username` + `x-admin-password` (must equal `SUPER_ADMIN_USERNAME`
  / `SUPER_ADMIN_PASSWORD`, both required together): only for
  `POST /admin/companies` and its `GET`/`DELETE` by id.
- `x-api-key` (a company's `apiKey`, shown once at creation): the Connector
  and the Admin Console both authenticate this way, acting "as the company."
- `x-extension-key` (an employee's `extensionKey`, shown once at creation):
  the browser extension's read/report endpoints.

Both `apiKey` and `extensionKey` are stored as SHA-256 hashes, never in
plaintext - see `../SECURITY.md`.

## CORS

`app.enableCors({ origin: true, ... })` is required - the extension's
content scripts fetch this backend from the *page's* origin (e.g.
chat.openai.com), not a privileged extension origin, so normal browser CORS
applies. See `../BUILD_LOG.md` (Week 3) for how this gap was found - every
Node-based test up to that point used `fetch` directly and never hit it.

## Main endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /admin/companies` | admin username+password | create a tenant, returns `apiKey` once |
| `POST /employees` | api-key | add an employee, returns `extensionKey` once |
| `GET /employees` | api-key | list employees with computed status |
| `DELETE /employees/:id` | api-key | disable an employee |
| `POST /connectors` | api-key | register a connector |
| `POST /connectors/:id/sync/{start,complete,fail}` | api-key | sync-run lifecycle |
| `POST /entities/batch` | api-key | connector ingests hashes |
| `GET /entities` | extension-key | extension reads the company's hash list (paginated) |
| `GET /companies/me` | api-key | company info + `entitySalt` |
| `PATCH /companies/me` | api-key | update `confidenceThreshold`/`enabledEntityTypes` |
| `GET /employees/me` | extension-key | employee + company info + `entitySalt`, for the extension |
| `POST /audit-logs` | extension-key | extension reports a blocked/allowed event |
| `GET /audit-logs` | api-key | admin console reads the audit trail |
| `GET /dashboard/summary` | api-key | admin console's summary cards/chart data |
