# BUILD_LOG.md — PII Shield

Continuous build log per spec section 6.7. Entries added as work progresses.

## 2026-08-03 — Kickoff

- Repo initialized (`git init`, branch `main`), monorepo layout planned:
  `backend/`, `connector/`, `extension/`, `admin-console/`.
- Spec saved as `PII-Shield-Spec.md`.
- Starting Week 1 (Backend + Data Model) per spec section 3.
- Local dev Postgres started as a dedicated Docker container `pii-shield-postgres`
  on port 5433 (kept separate from other unrelated containers already running
  on this machine). `docker-compose.dev.yml` documents this for reproducibility.

## Week 1 — Backend + Data Model — DONE

**Built:**
- NestJS backend scaffolded in `backend/`, Prisma + PostgreSQL wired up.
- `prisma/schema.prisma`: Company, Connector, Employee, SensitiveEntity, AuditLog.
- Admin bootstrap endpoint `POST /admin/companies` (guarded by `x-admin-secret`
  shared secret known only to the operator) creates a company and returns a
  raw `apiKey` exactly once.
- `POST/GET/DELETE /employees` (guarded by company `x-api-key`) creates/lists/
  disables employees; disabling immediately invalidates their extensionKey.
- `POST/GET /connectors` + `/connectors/:id/sync/{start,complete,fail}`
  (company `x-api-key`) for connector lifecycle and sync-run tracking.
- `POST /entities/batch` (company `x-api-key`) — connector ingest, upserts by
  (companyId, entityHash, entityType).
- `GET /entities` (employee `x-extension-key`) — paginated read of a company's
  hashes for the extension.
- `main.ts`: global `ValidationPipe` (whitelist + transform).

**Model fixes made before first migration (per section 6.7 point 3 — fixing
root causes instead of patching later):**
- Spec section 2 references `companySalt` for HMAC hashing but the given
  `Company` model didn't include that field. Added `Company.entitySalt`
  (unique, auto-generated) to close that gap.
- Hardened secret storage beyond the literal spec schema: `Company.apiKey`
  and `Employee.extensionKey` are stored as SHA-256 hashes
  (`apiKeyHash` / `extensionKeyHash`), not plaintext — same principle the spec
  already mandates for `entityHash`. Raw secrets are returned to the caller
  exactly once, at creation time, and never persisted or logged. SHA-256
  (fast hash) is appropriate here, not bcrypt, because these are 256-bit
  random secrets, not low-entropy passwords — indexed lookup by hash needs
  to stay fast.
- Added `Company.confidenceThreshold` (default 50) and `Connector.syncStartedAt`
  now rather than as a later migration, since both are needed by features
  explicitly planned for Week 2/4 (sync-run pruning, sensitivity settings).
- Added `Company.deletedAt`/`status` for soft-delete (edge case in 6.6: company
  deletes itself → 30-day soft delete, not immediate hard delete). Hard
  purge-after-30-days is not implemented yet — flagged as open in the final
  summary when we get there.
- Added `Employee.activatedAt`/`disabledAt`/`lastActiveAt` to support the
  employee-management edge cases (installed/not-installed/inactive-30-days
  status, immediate revocation on disable).

**Edge cases from section 6.6 addressed at the backend layer:**
- "Two employees share the same extensionKey by accident" — partially
  addressed: `extensionKey` is unique per employee and hashed; first
  successful use sets `activatedAt`. Full device-binding (rejecting a second
  browser from using the same key) is deferred to Week 3 (Extension), since
  it requires a client-side device identifier the backend doesn't have yet.
  Flagged as open until Week 3.
- "Connector connection drops mid-sync" — addressed via sync-run tracking:
  `syncStartedAt` is set on `sync/start`; `sync/complete` only prunes entities
  with `seenAt < syncStartedAt` for that connector, and only fires on
  successful completion, so a dropped sync just leaves the connector's status
  as `syncing`/`error` rather than silently corrupting data. Retry/backoff
  itself is the connector's job (Week 2).
- "Same customer appears twice with different casing" — addressed by
  `normalizeValue()` (trim + lowercase + collapse whitespace) applied before
  hashing, shared as one util (`hashing.util.ts`) so backend/connector/
  extension can't drift out of sync on normalization rules.
- "Company deletes itself" — soft delete implemented (`status`, `deletedAt`);
  a scheduled hard-purge job after 30 days is not built yet (no scheduler in
  the backend yet) — flagged as open, revisit in Week 4.
- Tenant isolation (not explicitly in 6.6 but implied throughout) — covered by
  an e2e test asserting one company's employee cannot see another company's
  entities.

**Tests:**
- `hashing.util.spec.ts` (unit): normalization, hash determinism, per-company
  salt isolation.
- `test/pii-shield.e2e-spec.ts` (integration, against real Postgres in the
  `pii-shield-postgres` container): full week-1 definition-of-done flow
  (create company → create employee → ingest hashes → retrieve via
  extension endpoint), tenant isolation, disabled-employee rejection, and
  connector sync-prune behavior.
- `npm test` and `npm run test:e2e`: all passing (5/5, 5/5) as of this entry.

**Known rough edges to revisit later:** e2e run logs a "worker process failed
to exit gracefully" warning (likely a Postgres socket not closing instantly
on `app.close()`) — tests pass, not investigated further since it's cosmetic,
but worth a look before production deploy.

**Post-week-1 model fix (found while starting Week 2 planning):** the spec
says both the Connector and the Extension compute `entityHash` locally using
`HMAC-SHA256(value, companySalt)` so raw values never leave the customer's
network/browser — but nothing exposed `entitySalt` to either of them; it only
lived in the `Company` row. Added `GET /companies/me` (api-key) and
`GET /employees/me` (extension-key) to `session` module so each trusted
client can fetch the salt scoped to its own credential. Covered by an e2e
test. This is safe: the spec's threat model is "central server breach can't
recover raw values," and the salt going to the connector (inside the
customer's own network) and the extension (per-employee credential) doesn't
weaken that — it's necessary for them to do client-side hashing at all.

**Housekeeping fix:** e2e specs' `beforeAll`/`beforeEach` hooks were hitting
Jest's default 5000ms hook timeout once the Nest module graph grew past the
original scaffold size (ts-jest compiling more files) — not a real bug, just
too-short a timeout. Raised to 30000ms in both `test/app.e2e-spec.ts` and
`test/pii-shield.e2e-spec.ts`.

**Final Week 1 test status: `npm test` 5/5 passing, `npm run test:e2e` 6/6
passing.**

## Week 2 — Connector — DONE

**Built (`connector/`):**
- CLI (`commander`) with two commands: `sync` (one-off) and `daemon` (runs
  immediately, then repeats on `config.schedule` cron expression via
  `node-cron`).
- Two sources: `postgres` (generic table + column→entityType mapping via
  `pg`) and `csv` (column→entityType mapping via `csv-parse`), matching the
  spec's "start with generic Postgres/CSV" guidance.
- `sync.ts` orchestrates a full sync run: fetch `entitySalt` from
  `GET /companies/me`, auto-create a connector on first run (prints the id
  to save back into the config), `sync/start`, stream+hash+batch-post
  (`entities/batch`, 500 at a time), `sync/complete` on success or
  `sync/fail` on any thrown error.
- `backendClient.ts`: retries with exponential backoff (max 5 attempts,
  capped at 30s) on network errors and 5xx only; 4xx fails fast without
  retrying (spec 6.6: "connection drops mid-sync" should retry, but a bad
  config/revoked key shouldn't retry forever).
- `hashing.ts` is a deliberate byte-for-byte copy of the backend's
  normalize/hash logic (own copy, not a shared package, since connector and
  extension run in different runtimes) — a cross-package unit test
  (`src/hashing.spec.ts`) imports the backend's copy directly and asserts
  identical output, so the two can't silently drift.
- Same-value-within-one-run dedupe (spec 6.6: "same entity appears multiple
  times") happens client-side in `sync.ts` before sending, not just relying
  on the backend's upsert.
- `Dockerfile` (multi-stage build) + `.dockerignore` + `config.example.json`
  + `README.md` with `docker run` instructions.

**Definition of done, verified for real (not just unit tests):** seeded a
separate demo database (`customer_crm_demo`, its own Postgres database in
the same dev container, simulating the customer's own CRM — not commingled
with the app's own tables) with a `customers` table of 50 rows, including
one pair that's identical except for case/whitespace to exercise dedupe.
Ran the actual connector (`test/sync.integration.ts`, see below) against a
real backend instance and confirmed exactly 196 unique hashes (49 unique
values × 4 mapped columns) arrived and are retrievable via the paginated
`GET /entities` endpoint. Also manually ran the built CLI (`node dist/index.js
sync`) against a CSV source, and the built Docker image via `docker run`
against the host backend (`host.docker.internal`) - both produced correct
results end-to-end.

**Real bugs found and fixed while building this:**
1. Running the compiled backend via `ts-node` directly (needed to spin up a
   real backend for integration testing) failed with TS1272: several
   controllers imported `Company`/`Employee` from `@prisma/client` as normal
   imports but only ever used them as parameter *type* annotations — invalid
   under the backend's `isolatedModules: true` tsconfig setting once run
   through a single-file transpiler instead of Nest's own webpack builder
   (which had been silently tolerating it). Fixed by switching those to
   `import type { ... }` across `employees/*.ts`, `connectors/*.ts`,
   `entities/*.ts`, `session/session.controller.ts`, and the
   `current-company`/`current-employee` decorators. This is safe: Prisma's
   `Company`/`Employee` are plain interfaces, not runtime classes, so
   `emitDecoratorMetadata` was always going to emit `Object` for them either
   way — nothing depended on the value import. Reran full backend `npm test`
   (5/5) and `npm run test:e2e` (6/6) afterward to confirm no regressions.
2. The first version of the connector's integration test spawned the backend
   as a child process with `stdio: 'pipe'` but only drained `stderr`, not
   `stdout`. Nest's startup logging is verbose enough to fill the OS pipe
   buffer, at which point the child process blocks on its next `write()` —
   the whole test then hangs forever with zero CPU usage on both the test
   and backend processes (this was mistaken at first for a `fetch()`/IPv6
   localhost-resolution hang; ruled that out by reproducing the exact same
   spawn+fetch logic as a plain script outside Jest, which completed in ~3s).
   Draining both `stdout` and `stderr` fixed it in a plain-script rerun -
   but the *same* now-correct script still hung specifically when run
   *inside a Jest test* (`beforeAll`/`it`), reproduced twice. Rather than
   keep fighting Jest's worker/child-process sandboxing for this one
   spawn-a-real-server case, the test was converted to a standalone script
   (`connector/test/sync.integration.ts`, run via `npm run test:integration`,
   not picked up by Jest's testRegex) with manual assertions. This is a
   pragmatic scope decision, not a workaround for a real product bug -
   flagged here in case the same Jest+child_process hang resurfaces for the
   Extension's own tests in Week 3.

**Edge cases from 6.6 addressed:** connection-drop retry/backoff, same
entity appearing multiple times, casing/whitespace duplicates (see Week 1
entry for the shared `normalizeValue`) — all covered above. Source-changes-
between-syncs pruning was built in Week 1 (`sync/complete`); not
independently re-tested here since it's backend-owned logic, already covered
by `test/pii-shield.e2e-spec.ts`.

**Known open item:** the connector loads an entire Postgres table into
memory in one query (`SELECT ... FROM table`, no cursor/streaming) — fine
for demo-scale data (tested at 50 rows) but would need a cursor-based
approach for a real customer table with millions of rows. Not built now;
flagged as a pre-production scaling item, out of scope for the MVP demo.

**Test status:** connector `npm test` (Jest, unit only) 3/3 passing;
`npm run test:integration` (standalone script) passing; `npm run build`
clean; Docker image builds and runs correctly via `docker run`.

Next: Week 3 (Extension).

## Week 3 — Extension — DONE

**Built (`extension/`):** Chrome MV3, React + Vite popup, TypeScript
throughout, matching the spec's stack table.

- **`shared/`** (pure logic, unit tested, no DOM/chrome dependency):
  - `hashing.ts` - Web Crypto (`crypto.subtle`) HMAC-SHA256, same
    normalize+hash algorithm as backend/connector. A cross-implementation
    test imports Node's `crypto` directly and asserts identical output.
  - `idChecksum.ts` - Israeli ID check-digit validation.
  - `detectors.ts` - regex candidates for id_number/email/phone/amount, plus
    a word-n-gram (1-4 words, Unicode letter-aware so Hebrew and English
    both work) generator for name/case_number candidates.
  - `tokenizer.ts` - the core engine. Structured regex candidates are
    checked against a hash index; n-gram candidates are the *only*
    mechanism for names (this - not language-specific NER - is what makes
    Hebrew and English work identically, and is the actual "company-specific
    detection" the whole product is about: a candidate is only ever hidden
    if its hash matches something the company's own connector actually
    ingested). Overlapping matches resolve to the longest span. Same entity
    anywhere in the message/conversation gets one stable token
    (`TokenStore`, in-memory only, cleared when the tab closes).
  - `config.ts` / `messages.ts` - `chrome.storage.local` config, and the
    postMessage protocol between the two content-script worlds (below).
- **`isolated/`** (isolated-world content script): `entityStore.ts` fetches
  `entitySalt`+`confidenceThreshold` (`GET /employees/me`) and the full hash
  list (`GET /entities`, paginated) on load and every 5 minutes; sets
  `failSafe: true` on any fetch failure. `badge.ts` shows a small fixed
  status badge. `responseObserver.ts` uses a `MutationObserver` on
  `document.body` to detokenize tokens as they appear in the rendered chat
  response - chosen over patching streamed fetch/XHR responses because a
  token could be split across SSE chunks; operating on final rendered DOM
  text sidesteps that entirely.
- **`main-world/content-main.ts`**: patches `window.fetch` and
  `XMLHttpRequest.prototype.send`. For each outgoing request it reads the
  live value of the focused textarea/contenteditable, asks the isolated
  script (via `postMessage`, since MAIN-world scripts have no `chrome.*`
  access) to tokenize it, then does a deep exact-string replace of that
  value inside the JSON request body (falling back to raw substring replace
  for non-JSON bodies). This is provider-agnostic by construction - it
  doesn't need to know ChatGPT/Claude/Gemini's specific request schema,
  only that the literal typed text appears somewhere in the body, which
  holds for all three today.
- **`popup/`**: minimal React form to save `backendUrl` + `extensionKey`
  into `chrome.storage.local`, with a live connectivity check against
  `GET /employees/me` before saving.
- Build: Vite builds the popup as a normal ES-module SPA;
  `scripts/build-content-scripts.mjs` bundles the two content scripts *and*
  the background service worker separately via esbuild in IIFE format (see
  bug #2 below for why).

**Edge cases from spec 6.6 addressed:**
- Same entity repeated in a message → one token (tokenizer test).
- Hebrew+English mixed in one message → both handled by the same
  language-agnostic n-gram+hash mechanism (tokenizer test).
- Backend unreachable → fail-safe: regex-detected structured PII is still
  blocked unconditionally; name detection is skipped (nothing to compare
  against); badge shows the spec's exact warning text (tokenizer + e2e test).
- ID-shaped number failing the check digit → never blocked, regardless of
  what's in the index (tokenizer test).
- User edits the message after tokenization already ran → since
  `tokenizeText` is re-run fresh against whatever the live input contains at
  send time (not a cached prior tokenization), an edit is naturally reflected
  correctly; no stale-mapping bug is possible by construction (tokenizer
  test simulates this directly).
- Very long pasted text → n-gram scanning yields to the event loop every 200
  candidates (`NGRAM_YIELD_EVERY`) so it can't freeze the tab; not
  benchmarked against a genuinely huge document (multi-MB paste) - flagged
  as an open perf question, same spirit as the connector's non-streaming
  query limitation.
- Badge "X hidden in this message" / fail-safe warning text: implemented
  literally per spec's Hebrew wording.
- Two employees sharing one extensionKey: deferred to the backend (Week 1
  `activatedAt`) - the extension itself has no additional handling, since
  there's nothing meaningfully different it could do beyond sending the key
  on every request.

**Real bugs found and fixed while building this (all four were only
findable by actually running this in a browser - nothing in Weeks 1-2
would have caught any of them):**

1. **Token-numbering/orphan-entry bug in `tokenizer.ts`.** Tokens were
   created *during* candidate scanning, before overlap resolution discarded
   shorter overlapping matches (e.g. "Avner" inside "Avner Cohen") - so a
   discarded candidate still consumed a token number and left a real,
   never-sent entry in the `TokenStore`, which `detokenizeText` would later
   treat as legitimate. Fixed by collecting all candidate spans first,
   resolving overlaps, and only calling `TokenStore.getOrCreateToken` for
   the spans that survive. Caught by a unit test
   ("prefers the longer overlapping match"), not the e2e test.
2. **Vite's default code-splitting broke the content scripts.** Vite
   bundles shared modules (e.g. `shared/messages.ts`, imported by both
   content scripts) into separate chunk files loaded via ES `import` -
   fine for the popup (`<script type="module">`), fatal for content
   scripts, which `manifest.json`'s `content_scripts.js` array loads as
   classic (non-module) scripts. Fixed by building the two content scripts
   (and the background service worker) as separate, fully self-contained
   IIFE bundles via esbuild (`scripts/build-content-scripts.mjs`), and
   restricting Vite's own build to just the popup.
3. **`content-isolated.ts` silently died on load.** It was declared
   `run_at: "document_start"`, but at that point `document.body` doesn't
   exist yet; `observeResponses(tokenStore)` (which calls
   `document.body.MutationObserver.observe`) threw synchronously, which -
   since this is a single bundled script - aborted every statement after it,
   including the *first* `refreshEntityStore()` call. The result was a
   silent, permanent fail-safe state that looked identical to normal
   operation (the badge's default text and the fail-safe text are only
   distinguished by `updateBadge`, which never got called). This is exactly
   the failure mode spec 6.6 warns about ("never send unchecked") except
   inverted - here checking silently never even started. Fixed by moving
   the isolated content script to `run_at: "document_end"` and, as defense
   in depth, wrapping the DOM-dependent init in a check that waits for
   `DOMContentLoaded` if `document.body` isn't there yet.
4. **No CORS on the backend.** The content script's fetch to
   `GET /employees/me`/`GET /entities` runs with the *page's* origin (e.g.
   `chat.openai.com`), not an extension-privileged origin - `host_permissions`
   grants script injection, not a CORS exemption for `fetch()`. Every real
   browser request was silently rejected by the browser's own CORS check
   before ever reaching the backend, which is why this was invisible to
   every Week 1/2 test (all used Node's `fetch`, which doesn't enforce
   CORS). Fixed with `app.enableCors({ origin: true, allowedHeaders: [...] })`
   in `backend/src/main.ts`. Reflecting the request origin is safe here
   specifically because auth is via explicit `x-api-key`/`x-extension-key`
   headers, not cookies - there's no CSRF-style ambient credential to leak.
   Reran full backend `npm test`/`npm run test:e2e` afterward - still 5/5
   and 6/6.
5. **`npx ts-node ...` orphans its own child process.** Both this test and
   the connector's `test/sync.integration.ts` originally spawned the backend
   via `spawn('npx', ['ts-node', ...])`. `npx`'s own wrapper process exits
   once it hands off to `ts-node`, so the `ChildProcess` handle the test
   holds is for a process that's already gone - `.kill()` on it does
   nothing, and the real backend process gets reparented and keeps running
   forever. Reproduced concretely: repeated test runs left multiple
   orphaned backend processes squatting the test port, so a *later* run's
   "fresh" backend spawn would silently fail to bind and the test would
   unknowingly hit a stale, pre-fix process - which is exactly what
   happened partway through debugging bug #4 above (the CORS fix appeared
   not to work for two runs in a row, because the old backend without the
   fix was still the one answering). Fixed in both places by spawning
   `node -r ts-node/register -r tsconfig-paths/register src/main.ts`
   directly instead of going through `npx`/the ts-node CLI wrapper.

**What was actually verified vs. what wasn't:** the Week 3 spec definition
of done calls for pasting PII into a *real* ChatGPT/Claude conversation and
checking the Network tab. That's not reachable from this environment (no
GUI browser session against those live sites). Instead, `e2e/extension.spec.ts`
loads the real built extension (unpacked, from `dist/`) into a real
Chromium instance via Playwright, against a local mock chat page
(`e2e/mock-chat-page.html` + `e2e/mock-provider-server.mjs`) that mimics a
textarea/send-button/response-render loop backed by a real spawned backend
instance with a real seeded company entity. The test asserts the mock
provider's server *actually received* a tokenized payload (not just that
the extension's internal function returned a tokenized string) and that the
rendered response shows the real values again. This is a faithful automated
stand-in for the spec's manual check, but real chat.openai.com/claude.ai/
gemini.google.com have never been touched - their actual DOM structure and
API request shapes could differ from what this generic mechanism assumes,
so a manual install-and-try pass against the real sites is still worth
doing before relying on this for real PII.

**Test status:** `npm test` (Jest, unit) 18/18 passing; `npm run e2e`
(Playwright, real Chromium + real backend + mock provider) 1/1 passing;
`npm run build` produces a loadable unpacked extension with no bundler
errors.

Next: Week 4 (Admin Console + polish + deploy prep).

## Week 4 — Admin Console + polish + deploy prep — DONE

**Backend additions needed before the console could be built** (discovered
gaps, not scope creep - the spec's own dashboard/settings screens depend on
data nothing was producing yet):
- `AuditLog` had a table but no endpoints. Added `POST /audit-logs`
  (extension-key - an employee's extension reports what it just blocked)
  and `GET /audit-logs` (api-key, paginated, filterable by employee/entityType).
- Wired the extension itself to actually call `POST /audit-logs` (fire-and-
  forget, one call per hidden entity) after tokenizing - without this the
  dashboard would only ever show zeros. Confirmed via the existing extension
  e2e test still passing (it doesn't assert on audit logs directly, but
  exercises the code path) plus a dedicated backend e2e test for the
  endpoints themselves.
- Added `GET /dashboard/summary` (api-key): blocks this month, employee
  counts, connector statuses, a 30-day blocks-by-day series, and total
  entities synced (the last one added specifically so the onboarding
  wizard's "initial sync progress" step has something real to show).
- Added `Company.enabledEntityTypes` (Postgres string array, defaults to
  all six types) and `PATCH /companies/me` to update it and
  `confidenceThreshold` together. Wired `enabledEntityTypes` into
  `GET /employees/me` and `GET /companies/me` so the extension's tokenizer
  actually respects the toggle (not just a UI control with no effect) -
  added a dedicated unit test for this.
- `EmployeesService.list` now returns a computed `status`
  (`not_installed`/`active`/`inactive`/`disabled`) from `activatedAt`/
  `lastActiveAt`/`disabledAt` instead of raw rows, matching the spec's
  employee-table statuses. Covered by an e2e test exercising all three
  non-default states.
- **Found and fixed a real modeling bug while building the onboarding
  wizard's "check connection" step:** `Connector.status` defaulted to
  `"connected"` at creation - meaning a connector nobody had run yet already
  looked connected, which would have made the wizard's "בדוק חיבור" check
  meaningless (it always would've shown success). Changed the default to
  `"pending"` via a new migration; `sync/start`/`complete`/`fail` already
  transition it correctly from there.

**Architectural resolution (spec contradiction, per section 6.7 point 3):**
section 6.5's onboarding wizard describes step 3 as showing live sync
progress ("נסרקו 340 רשומות..."), which reads as if the admin console
*drives* the sync - but section 1's architecture has the Connector as a
separate process/Docker container running inside the *customer's own*
network, which a centrally-hosted admin console has no way to reach into
and execute. Resolved by having the console *poll* connector/entity state
that the connector itself independently pushes (`GET /connectors`,
`GET /dashboard/summary`), not orchestrate it - the wizard shows a
"create connector → here's your apiKey and a docker run command → run this
yourself → we'll detect it" flow instead of a "click to sync" button. This
also naturally satisfies the spec's own note that first sync doesn't have
to complete during the wizard (added a "skip for now" option, since a
real customer's connector might take longer than an onboarding session to
run).

**Admin Console (`admin-console/`)**, React + Vite + Tailwind, built with:
- **Onboarding wizard** (4 steps): company details (requires the
  operator's `ADMIN_BOOTSTRAP_SECRET`, framed in-UI as a "setup code from
  your provider" - see note below on why this wasn't changed to self-serve),
  connect-a-source (creates a `Connector` row, shows the apiKey + a
  `docker run` command, polls for connection), initial-sync progress
  (polls `entitiesCount`/connector status), done (shows the apiKey once
  more + next-steps text). Wizard state (`step`, `companyId`, `apiKey`,
  `connectorId`) is persisted to `localStorage` on every transition and
  reloaded on mount, so closing the browser mid-wizard resumes instead of
  re-creating a second company (spec 6.5's explicit edge case).
- **Dashboard**: summary cards (blocks this month, active/total employees,
  per-connector status dots), a small hand-rolled SVG bar chart for the
  30-day blocks history (skipped adding a charting library dependency for
  something this simple), the audit log table, and an empty-state card
  when there are truly no employees or connectors yet.
- **Employees**: table with computed status badges, single-add (shows the
  one-time `extensionKey`), bulk CSV import (client-side parse, row-level
  preview with per-row errors before confirming, continues past bad rows
  rather than rejecting the whole file, matching spec 6.5), disable button.
- **Settings**: confidence-threshold slider and per-entity-type toggles,
  `PATCH /companies/me`.
- No separate multi-user admin login was built - the console authenticates
  as "this company" via its `apiKey` in `localStorage`, the same mechanism
  decided (and explicitly flagged as revisitable) back in Week 1. Building
  a real per-admin-user login system wasn't requested by the spec beyond
  the wizard capturing an admin email, and would have meant inventing a new
  password/session model with no corresponding backend design - reusing the
  existing apiKey-based auth is the smaller, already-verified surface.

**Verified for real, not just "should work":** `admin-console/manual-verify.mjs`
(`npm run verify`) drives the actual built console in a real headless
Chromium via Playwright against a real running backend - the full
onboarding wizard end to end, adding an employee and confirming its status
renders correctly, and saving a settings change and confirming it survives
a page reload. This is the same "don't trust it until it's exercised in a
real browser against a real backend" standard applied in Week 3, and it
caught nothing broken this time - but it's what actually gives confidence
the wizard's localStorage-resume logic and the settings persistence work,
which no unit test alone would prove.

**Test status:** backend `npm test` 5/5, `npm run test:e2e` 8/8 (up from
6, covering the four new endpoints); connector `npm test` 3/3, `npm run
test:integration` passing; extension `npm test` 19/19 (added one for
`enabledEntityTypes` filtering), `npm run e2e` 1/1; admin-console
`npm run build` clean, `npm run verify` all checks passing.

**Docs added:** root `README.md` (component overview + quick start),
`SECURITY.md` (hashing/threat model, stated known limitations - including
the honest one about low-entropy value types like ID numbers being weaker
against an offline guessing attack on a stolen hash+salt than higher-
entropy names), `backend/README.md` (env vars, auth model, endpoint table),
`connector/README.md`, `extension/README.md`, `admin-console/README.md`.

---

## Railway deployment (production) — 2026-08-03

Project `beautiful-bravery` (Railway, environment `production`) had already
been created and connected to the `DAVIDafergan/GHOSTAI` GitHub repo with 4
services (backend, admin-console, connector, extension) before this
session. Investigated and fixed via the `railway` CLI + GraphQL API
(Railway's MCP server was unreachable - OAuth callback issue on this
Chromebook/Linux environment - so the CLI, already authenticated, was used
directly instead).

**Deleted:** the `extension` service. A Chrome extension is not a server -
it was deployed as one by mistake and had nothing to serve; there is no
"fix," it simply shouldn't exist as a Railway service.

**Real bugs found and fixed:**
- **Backend build failed** (`TS2305: Module "@prisma/client" has no
  exported member 'Company'`, 18 errors). Root cause: Railway's build never
  ran `prisma generate` - it only ran `npm install` then `nest build`, so
  `@prisma/client` stayed an empty stub. This never surfaced locally
  because `npx prisma migrate dev` (run constantly during weeks 1-4)
  generates the client as a side effect. Fixed with a `postinstall: prisma
  generate` script in `backend/package.json`.
- **Backend had no database and no required secrets.** The project had no
  Postgres at all (`railway add --database postgres`), and `DATABASE_URL`,
  `JWT_SECRET`, `ADMIN_BOOTSTRAP_SECRET` were all unset. Wired
  `DATABASE_URL` as a live reference (`${{Postgres.DATABASE_URL}}`, stays in
  sync if credentials ever rotate) rather than a copied literal value.
  Generated `JWT_SECRET` randomly (unused by any active auth check right
  now, so safe to auto-generate). `ADMIN_BOOTSTRAP_SECRET` was provided by
  the user directly, piped straight into `railway variable set --stdin` -
  never invented or logged.
- **Backend had no migration step on boot.** Railway has no separate
  "release phase" the way some other PaaS's do. Changed `start` from `nest
  start` (dev-mode compile-and-run) to `prisma migrate deploy && node
  dist/main`, so pending migrations always apply before the app boots.
- **admin-console was silently running the wrong process.** Logs showed
  `> vite` / `Local: http://localhost:5173` in "production" - the Vite
  *dev* server, bound to loopback, on a hardcoded port, ignoring Railway's
  `$PORT` entirely. Root cause: no `start` script existed in
  `admin-console/package.json` at all, so Railway's builder (Railpack)
  silently fell back to the `dev` script. It reported deploy status
  "SUCCESS" throughout, because "the process didn't immediately exit" is a
  different signal from "the app actually works" - a real product bug that
  monitoring by status label alone would never catch. Fixed by adding
  `serve` as a real (non-dev) dependency and a
  `start: serve -s dist -l ${PORT:-4173}` script; verified locally
  (`curl` → 200) before pushing.
- **Even after the fix, still 502'd.** Two separate causes, found only by
  actually querying Railway's GraphQL API directly (`railway api`), since
  the CLI's own status/log output doesn't surface either:
  1. `railway service redeploy` (no `--from-source`) replays the *existing*
     deployment's frozen command snapshot - it does not pick up an updated
     `serviceInstance.startCommand`. Had to use `--from-source` to force a
     genuinely new build+deploy.
  2. The service's `ServiceDomain.targetPort` was hardcoded to `5173` -
     presumably auto-detected once when it was first (wrongly) running the
     Vite dev server - so Railway's edge kept routing to port 5173 even
     after the container switched to listening on Railway's dynamically
     assigned `$PORT` (8080). Backend's own domain, by contrast, has
     `targetPort: null` (follows whatever port the app actually listens
     on) and never had this problem. Cleared it via
     `serviceDomainUpdate(targetPort: null)`. This is the kind of
     stale-cached-config bug that only shows up when you actually curl the
     public URL after a "successful" deploy, not when you just read the
     deploy status.
- **Connector crashes on start** (`Usage: pii-shield-connector...` then
  exit 1). Root cause: it's a CLI that hard-requires `--config <path>`
  pointing at a JSON file with a customer's own CRM connection string and
  field mappings; nothing on Railway supplies one, and `loadConfig()` only
  reads from a file, never from env vars. This isn't a bug to patch - per
  the original spec the connector is meant to run *inside a customer's own
  network* (there's already a dedicated `connector/Dockerfile` for exactly
  that), not as a permanent service in the operator's own Railway project.
  Asked the user; decision was to leave it un-deployed rather than build
  env-var-driven demo config. Railway does not support scaling a service to
  0 replicas (`numReplicas`/`multiRegionConfig` both reject values below 1
  server-side) - there is no "pause without deleting" primitive - so it
  sits in its natural `ON_FAILURE` end state (retries exhausted at
  `restartPolicyMaxRetries: 10`, then stops) rather than crash-looping
  forever. Revisit if/when there's an actual demo data source to point it
  at.

**Verified at the end:** backend `GET /` → 200 with a real Postgres behind
it (`Nest application successfully started`, all modules initialized);
admin-console `GET /` → 200 serving the real built SPA (confirmed by
fetching the actual HTML, not just a status code); extension service gone;
connector intentionally left stopped, not fixed. All via public HTTPS
URLs, not internal-only checks.

---

## Onboarding wizard UX pass + extension options page — 2026-08-04

Two rounds of UX fixes on the admin-console onboarding wizard, then the
same "the popup closes" complaint on the extension side.

**Onboarding wizard, round 1:** added helper text and "how do I find this?"
disclosures to every field across all 4 steps (steps 3-4 turned out to have
no input fields at all, so nothing to do there). Moved the backend URL out
of step 1 into a collapsed "advanced settings" section, since it's server
infrastructure, not a company detail. Verified with real Playwright
screenshots of all 4 steps against a real local backend before pushing.

**Onboarding wizard, round 2 (real bug, not cosmetic):** the user got stuck
on step 1 because the "activation code" field's copy was written as if the
person filling the form is a *customer* who received a one-time code from
the PII Shield provider. That's backwards - this whole screen is gated by
`ADMIN_BOOTSTRAP_SECRET`, known only to the operator, and is the
*operator's own* tool for creating a new customer company (per the
architecture already documented in `admin-console/README.md` - there is no
separate self-serve signup). Relabeled the field, rewrote the error/help
text, and added an intro line clarifying who the screen is for. Flagged
but did not build (per user's choice) the deeper fix: splitting this into
a real operator-only "create company" form plus a separate customer-facing
"connect your data source" link using just the apiKey, so an operator could
actually hand off steps 2-4 to a customer's IT person without exposing the
master secret.

**A second, unrelated bug surfaced while debugging step 1**: an actual
submission attempt produced zero HTTP requests against the backend at all
(confirmed via `railway logs --http --path /admin/companies --since 30m` -
nothing, not even a rejected one) - the "backend URL" field still had its
`http://localhost:3000` default, which on a real deployed admin-console
means "the user's own machine," not Railway. The browser fails to connect
before the request ever leaves the device, surfacing as the same generic
network-error message as a wrong secret would. Not a code bug - the field
already exists and is documented - but confirms the UX gap was real:
nothing in the UI warns you the default is almost certainly wrong once
you're not running against localhost.

**Extension options page:** the popup closes on tab-switch (standard
Chrome behavior for `default_popup`), which makes pasting a long backend
URL or extension key into it painful - you lose focus, it closes, you lose
your progress. Added a proper options page (`options_ui` with
`open_in_tab: true`) that opens as a normal persistent tab. Extracted the
existing popup's form logic into a shared `useSettingsForm` hook so the
popup and the new options page share one implementation instead of two
copies drifting apart; the popup keeps its compact form plus a new "open
as full page" link that calls `chrome.runtime.openOptionsPage()`.
Verified with a real loaded extension in real Chromium: direct navigation
to `options.html` renders correctly, and - the actual bug being fixed -
typed values in it survive switching to another tab and back (the popup
would have simply closed). One thing that could **not** be verified this
way: whether the popup's "open as full page" link actually opens a new tab
when clicked - `chrome.runtime.openOptionsPage()` reports success
(`chrome.runtime.lastError` is null) but no new tab appears in Playwright's
tracked pages. This looks like a Playwright/CDP limitation specific to
extension-triggered tab creation in an automated context (the manifest is
confirmed correctly loaded with `open_in_tab: true` via
`chrome.runtime.getManifest()`), not a product bug, but it's genuinely
unverified - worth a real manual click after installing the built
extension. Full unit suite (19/19) and the existing e2e PII-blocking test
still pass unchanged.

---

## Final summary

**What works, verified end-to-end against real infrastructure (not mocked)
at least once:**
- Backend: full CRUD/auth/ingest/sync-lifecycle/audit-log/dashboard/settings
  surface, against a real Postgres, 13 e2e tests.
- Connector: Postgres and CSV sources, retry/backoff, sync-run pruning,
  Docker image, verified against a real seeded 50-row database through a
  real spawned backend.
- Extension: regex + n-gram/hash-list detection, tokenization with stable
  per-entity tokens, fail-safe degradation, network-layer interception via
  a real Chromium loading the real built extension against a real backend
  and a mock chat page - proven that a known name and ID number never
  reached the "provider," and that the rendered response was restored.
- Admin Console: full onboarding wizard (including resume-after-reload),
  employee management with CSV import, dashboard, and settings - all driven
  through a real browser against a real backend.
- All four components' automated test suites pass as of this entry.

**What was not tested / is explicitly still open:**
- **Real chat.openai.com/claude.ai/gemini.google.com were never touched.**
  The extension's interception mechanism (matching the literal typed text
  as a JSON string value in the outgoing request body) is provider-agnostic
  by design, but its actual DOM selectors for finding the input field
  (`textarea`, `[contenteditable="true"]`) and its request-body-matching
  approach have only been proven against a purpose-built mock page. A
  manual install-and-try pass against the three real sites is the one
  thing in this whole build that couldn't be substituted with an automated
  equivalent, and should happen before trusting this with real PII.
- No automated purge job for soft-deleted companies (30-day retention is
  modeled, nothing runs the actual deletion).
- Connector doesn't stream large tables via a cursor - untested past 50 rows.
- Extension's n-gram scanning hasn't been benchmarked against a genuinely
  large pasted document (multi-MB); it yields to the event loop periodically
  by construction but the actual wall-clock cost at that scale is unknown.
- The "two employees share one extensionKey" edge case (spec 6.6) has no
  device-binding on the extension side - only first-use `activatedAt` is
  tracked backend-side. Revisit if this becomes a real support issue.
- No production deploy has happened. `docker-compose.dev.yml` and each
  component's Dockerfile/README cover local dev; going from there to
  Railway (per spec section 7.5) is the next action, not something this
  build attempted.
- CORS is `origin: true` (reflects any origin) - safe under the current
  header-based auth model per `SECURITY.md`, but worth tightening to an
  explicit allowlist before a production deploy, as defense in depth.

**Real bugs found across all four weeks, for reference:** an ambiguous
Company.entitySalt gap in the spec's own schema (Week 1); insecure
plaintext-adjacent secret storage upgraded to hashed apiKey/extensionKey
(Week 1); a token-numbering bug from resolving overlaps after already
minting tokens (Week 3); Vite code-splitting silently breaking classic-
script content scripts (Week 3); a `document_start` timing bug that put the
extension into a permanent, invisible fail-safe state (Week 3, arguably the
most important one found - it directly contradicts the spec's core "never
send unchecked" requirement while *looking* like everything was fine);
missing CORS entirely (Week 3); `npx <tool>` orphaning child processes and
causing a later test run to silently hit a stale pre-fix server (Week 2 and
3); and a connector default-status value that would have made the
onboarding wizard's connection check meaningless (Week 4). None of these
were hypothetical - each was reproduced, root-caused, fixed, and re-verified
before moving on.

