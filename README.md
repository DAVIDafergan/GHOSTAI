# PII Shield

Prevents company-sensitive data from reaching external AI tools
(ChatGPT/Claude/Gemini). See `PII-Shield-Spec.md` for the original product
spec and `BUILD_LOG.md` for what was actually built, what deviated from the
spec and why, and every real bug found while building it.

## Components

| Directory | What it is |
|---|---|
| `backend/` | NestJS + PostgreSQL, multi-tenant, stores only entity hashes - never raw values. See `backend/README.md`. |
| `connector/` | Node CLI/daemon that runs inside a customer's own network, hashes their data locally, sends only hashes to the backend. See `connector/README.md`. |
| `extension/` | Chrome Extension (MV3) that intercepts outgoing chat messages, tokenizes sensitive values before they leave the browser, and restores them in the response. See `extension/README.md`. |
| `admin-console/` | React admin dashboard: onboarding, employee management, activity dashboard, sensitivity settings. See `admin-console/README.md`. |

## Local development quick start

```bash
# 1. Postgres (dedicated container, doesn't touch anything else on the machine)
docker compose -f docker-compose.dev.yml up -d

# 2. Backend
cd backend
cp .env.example .env   # fill in ADMIN_BOOTSTRAP_SECRET etc.
npm install
npx prisma migrate dev
npm run start:dev

# 3. Admin console (separate terminal)
cd admin-console
npm install
npm run dev
# open http://localhost:5173, run through onboarding

# 4. Connector (separate terminal, needs a data source to point at)
cd connector
npm install
cp config.example.json connector.config.json   # fill in apiKey from step 3
npm run build
node dist/index.js sync --config ./connector.config.json

# 5. Extension
cd extension
npm install
npm run build
# chrome://extensions -> Developer mode -> Load unpacked -> extension/dist
# click the extension icon, enter backend URL + an employee's extensionKey
```

## Security

See `SECURITY.md` for the hashing/threat model, and each component's own
test suite (`npm test`) for what's actually verified.
