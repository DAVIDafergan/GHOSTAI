# Nistar Super Admin

Separate, operator-only React app for creating and monitoring customer
(company) accounts. Not something a customer ever sees or has access to -
a distinct app, own auth, own deployment, deliberately kept apart from
`admin-console` (which authenticates as a specific company) so there's no
way for the two trust boundaries to blur together.

## Auth model

Authenticates as the Nistar operator via `ADMIN_BOOTSTRAP_SECRET` -
the same secret that gates `POST /admin/companies` on the backend, not any
individual company's `apiKey`. Stored in its own `localStorage` key
(`piiShieldSuperAdminSession`), separate from `admin-console`'s, so the two
apps can't cross-contaminate a session even if both happen to be open in
the same browser.

## Run

```bash
npm install
npm run dev
```

Requires a running backend (see `backend/.env.example` for
`ADMIN_BOOTSTRAP_SECRET`) reachable at whatever URL you enter at sign-in.

## Build

```bash
npm run build
npm start   # serves dist/ - what Railway runs in production
```
