# Nistar Admin Console

React + Vite + Tailwind SPA for managing a Nistar company: onboarding,
employees, dashboard, and sensitivity settings.

## Auth model

There is no separate admin-user login system for individual companies. The
console authenticates as "acting on behalf of a company" using that
company's `apiKey` - the same credential the Connector uses - stored in
`localStorage` after either completing the onboarding wizard or (not yet
built) a "sign in with an existing apiKey" screen. Creating a *new* company
(onboarding step 1) additionally requires the Nistar operator's own
username+password (`SUPER_ADMIN_USERNAME`/`SUPER_ADMIN_PASSWORD` on the
backend), since company creation is gated to the operator, not self-serve
- see BUILD_LOG.md for why this was kept as-is from Week 1 rather than
building a full multi-user login system for companies themselves.

## Run

```bash
npm install
npm run dev
```

Requires a running backend (see `backend/README` - not written yet, see its
`.env.example`) reachable at whatever URL you enter in step 1 of onboarding.

## Build

```bash
npm run build
```

## Verify

```bash
npm run dev            # in one terminal
SUPER_ADMIN_USERNAME=... SUPER_ADMIN_PASSWORD=... npm run verify   # in another, with the backend running
```

`manual-verify.mjs` drives the actual built UI in a real (headless)
Chromium via Playwright against a real backend - not mocked - through the
full onboarding wizard, adding an employee, and saving settings, asserting
on what's actually rendered/persisted. This is what was used to confirm the
console works before considering Week 4 done (see BUILD_LOG.md).
