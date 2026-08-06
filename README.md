# Nistar

**Stops employees from leaking client-sensitive data into ChatGPT, Claude,
and Gemini - without slowing anyone down, and without the vendor ever
seeing the sensitive data itself.**

Employees increasingly paste real work into AI chat tools to draft, summarize,
or translate it - including client names, ID numbers, case details, and
other information an organization has a legal or contractual duty to
protect. Nistar intercepts that in the browser, in real time, and
either blocks it or replaces it with a safe placeholder before it ever
leaves the employee's machine.

## How it works

1. **A lightweight browser extension** runs on ChatGPT, Claude, and Gemini.
   It watches what an employee is about to send and checks it against the
   company's known-sensitive data - locally, in the browser.
2. **A connector runs inside the customer's own network** (not ours),
   reading whatever data source they point it at (a database, a CSV export)
   and computing a one-way hash of each sensitive value. Only the hash is
   sent onward.
3. **The central backend only ever stores hashes** (`HMAC-SHA256(value,
   company_salt)`), never the raw value. It has no way to reconstruct what
   a hash actually was.
4. If an employee tries to send something that matches, the extension
   blocks or redacts it before the request leaves the browser - and, if the
   backend is ever unreachable, it fails *closed* (blocks more, never
   less) rather than silently letting everything through.

The result: even a full breach of Nistar's own infrastructure exposes
hashes, not customer data. See [`SECURITY.md`](SECURITY.md) for the full
threat model, including its honestly-stated limitations.

## Components

| Directory | What it is |
|---|---|
| `landing/` | Public marketing page - what this is, who it's for, how to request a demo. |
| `extension/` | Chrome Extension (MV3) employees install. Intercepts outgoing chat messages, tokenizes sensitive values before they leave the browser, restores them in the response. |
| `connector/` | Node CLI/daemon that runs inside a customer's own network, hashes their data locally, sends only hashes to the backend. |
| `backend/` | NestJS + PostgreSQL API. Multi-tenant, stores only entity hashes - never raw values. |
| `admin-console/` | React dashboard for a customer's own admin: onboarding, employees, activity, sensitivity settings. |
| `super-admin/` | Separate, operator-only React app for creating and monitoring customer accounts. Not accessible to customers. |

Each component has its own `README.md` with setup details specific to it.

## Status

Pre-launch. Core product (extension, connector, backend, admin console,
super-admin) is built and tested end-to-end, including real-browser tests
against the actual structure of ChatGPT/Claude. A pre-customer hardening
pass (rate limiting, cross-tenant isolation testing, backups, error
handling, logging audit) is complete - see `BUILD_LOG.md` for the full,
dated history of what was built, every real bug found along the way, and
why. No production customer has been onboarded yet.

## Local development quick start

```bash
# 1. Postgres (dedicated container, doesn't touch anything else on the machine)
docker compose -f docker-compose.dev.yml up -d

# 2. Backend
cd backend
cp .env.example .env   # fill in SUPER_ADMIN_USERNAME/SUPER_ADMIN_PASSWORD etc.
npm install
npx prisma migrate dev
npm run start:dev

# 3. Admin console (separate terminal)
cd admin-console
npm install
npm run dev
# open http://localhost:5173, run through onboarding

# 4. Super admin (separate terminal, operator-only)
cd super-admin
npm install
npm run dev
# open http://localhost:5174, sign in with SUPER_ADMIN_USERNAME/SUPER_ADMIN_PASSWORD

# 5. Connector (separate terminal, needs a data source to point at)
cd connector
npm install
cp config.example.json connector.config.json   # fill in apiKey from step 3
npm run build
node dist/index.js sync --config ./connector.config.json

# 6. Extension
cd extension
npm install
npm run build
# chrome://extensions -> Developer mode -> Load unpacked -> extension/dist
# click the extension icon, enter backend URL + an employee's extensionKey

# 7. Landing page (separate terminal, optional - no backend dependency)
cd landing
npm install
npm run dev
```

## Security

See [`SECURITY.md`](SECURITY.md) for the hashing/threat model, and each
component's own test suite (`npm test`) for what's actually verified.
