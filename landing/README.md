# PII Shield Landing Page

Standalone marketing/informational page for first-time visitors - separate
from `admin-console` (the product itself, which requires an `apiKey` to do
anything) and `super-admin` (operator-only tooling). Static, no backend
calls, no auth.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm start   # serves dist/ - what Railway runs in production
```

## Configuration

`VITE_CONTACT_EMAIL` (build-time) - the address every "request a demo" CTA
mails to. Defaults to a placeholder; set it to a real, monitored address
before deploying this for real prospects to see (see `.env.example` and
BUILD_LOG.md's "Landing page" entry).
