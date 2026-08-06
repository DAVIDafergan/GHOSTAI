# Nistar Connector

Runs inside the customer's own network. Reads a configured data source
(Postgres table or CSV file), normalizes and hashes each sensitive value
locally with the company's `entitySalt`, and sends only those hashes to the
Nistar backend. Raw values never leave the network this runs in.

## Configure

Copy `config.example.json` to `connector.config.json` and fill in:

- `backendUrl` — the Nistar backend's URL
- `apiKey` — issued once when the company was created via `POST /admin/companies`
- `source` — `postgres` (connection string + table + column→entityType
  mappings) or `csv` (file path + column→entityType mappings)
- `schedule` — cron expression, only required for `daemon` mode
- `connectorId` — leave `null` on first run; the CLI creates a connector and
  prints the id to save back into this field so future runs reuse it

## Run

```bash
npm install
npm run build

# one-off sync
node dist/index.js sync --config ./connector.config.json

# scheduled daemon (syncs immediately, then on config.schedule)
node dist/index.js daemon --config ./connector.config.json
```

## Run in Docker

```bash
docker build -t pii-shield-connector .
docker run -v $(pwd)/connector.config.json:/config/connector.config.json pii-shield-connector
```

## Sync semantics

Each run is a single "sync run": it starts (`POST /connectors/:id/sync/start`),
streams the source, batches hashes to `POST /entities/batch`, and finishes
with `POST /connectors/:id/sync/complete`, which prunes any previously-seen
entity for this connector that wasn't re-affirmed in this run (i.e. the
source's row was deleted/renamed since the last sync). If the run throws at
any point (network drop, source error), it calls `sync/fail` instead, so the
backend never treats a partial sync as complete data. Requests to the
backend retry with exponential backoff (up to 5 attempts) on network errors
and 5xx responses only — 4xx errors (bad config, revoked apiKey) fail fast.
