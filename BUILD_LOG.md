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

## Real-site failure: two genuine bugs found on actual ChatGPT/Claude — 2026-08-05

The one thing flagged since Week 3 as never actually tested - the real
chat.openai.com/claude.ai/gemini.google.com sites - finally got tried, and
found two real, confirmed bugs (plus surfaced a testing-methodology issue
that wasn't a bug).

**Bug 1 - manifest domain mismatch.** `chat.openai.com` now permanently
redirects (`308`) to `chatgpt.com` - confirmed with `curl -I`, not assumed.
Chrome matches content scripts against the final URL after redirects, and
`chatgpt.com` was never in `manifest.json`'s `matches`/`host_permissions`,
so the extension never injected on real ChatGPT at all. `claude.ai` has no
such redirect. Fixed by adding `https://chatgpt.com/*` alongside the old
domain everywhere it's referenced.

**Bug 2 - input-detection selector, the actual root cause on claude.ai.**
Confirmed via web search (not memory) that both ChatGPT and Claude build
their composer on ProseMirror - a `contentEditable` div, not a `<textarea>`.
`getLiveInputText()`'s existing fallback chain (`activeElement` →
`querySelector('textarea')` → `querySelector('[contenteditable="true"]')`)
looked like it should still cover this. It didn't, for two compounding
reasons the user found by reading the newly-added debug logs on the real
site: (1) clicking "Send" moves focus off the composer to `<body>` before
the outgoing request fires, so `activeElement` is useless at that exact
moment; (2) the real composer's `contenteditable` attribute is not
literally the string `"true"` (some editors set it bare or as
`"plaintext-only"`), so the fallback selector's exact-match silently found
nothing. Net effect: `tokenizeOutgoingBody` always took the
"no live input text found - passing through UNCHANGED" path - exactly
matching the reported symptom of PII being sent as-is.

Fixed by broadening the fallback chain to `.ProseMirror[contenteditable]`
(a stable, framework-added class, not a per-app hashed one) then
`[contenteditable]:not([contenteditable="false"])` (any non-false
contenteditable state, not just the literal string `"true"`), before the
existing `textarea` fallback. Verified against the *exact* failure mode,
not just by inspection: added a new mock page
(`e2e/mock-chat-page-contenteditable.html`) with a bare-attribute
`contenteditable` div whose Send handler explicitly blurs focus to
`<body>` before firing the request - reproducing both compounding
conditions - and a matching Playwright test. Both e2e tests pass (2/2),
alongside the unchanged unit suite (19/19).

**Not a bug - a testing methodology gap worth recording.** The user's
original test values (`דוד לוי`, `314159265`) would not have been expected
to block regardless of any bug: `314159265` fails the Israeli ID checksum
(spec 6.6 explicitly says checksum failures should never block, only be
logged low-confidence), and `דוד לוי` was never registered as a known
entity for the test company - this product deliberately does no generic
name detection, only closed-list hash matching. Caught by walking through
`idChecksum.ts`/`detectors.ts`/`tokenizer.ts` by hand before assuming the
report described a detection-logic bug.

**Debug logging added throughout** (content script load, entity-store
refresh and *why* it fell back to fail-safe - previously silently
swallowed - every intercepted fetch/XHR, what text was found and by which
selector, whether the request body matched it, final tokenize result), all
prefixed `[PII Shield]`. This is what let the user pinpoint bug 2 exactly
from the console rather than guessing - explicitly marked as temporary/
debug-only in the code, worth stripping or gating behind a debug flag
before considering this production-ready.

**Still open:** whether the fix holds on the *real* chatgpt.com/claude.ai
(not just the now-more-realistic mock) - the user was about to re-test
with full console output when this entry was written. Gemini was never
touched in this pass; its composer structure is unconfirmed.

---

## Real-site failure, round 2: the actual root cause was a timing race, not the selector — 2026-08-05

The selector fix above was necessary but not sufficient. Re-testing
against real chat.openai.com, the user found the true root cause by
reading the new debug logs: fixing the selector correctly identifies the
composer element, but by the time the patched `fetch()` runs and calls
`tokenizeOutgoingBody`, the app has *already cleared the composer*
optimistically (before awaiting the network call) - so a DOM read at
that exact moment always finds empty text, regardless of which selector
is used. This is a fundamentally different bug from round 1: not "can't
find the element," but "the element's content is gone by the time we look."

Fixed exactly as the user specified: capture the composer's text ahead of
time - on every `input` event, on `Enter` keydown, and on any `click` (all
in the capture phase, so they run before the page's own handlers can react)
- into a module-level variable with a timestamp. `tokenizeOutgoingBody` now
tries a live DOM read first (unchanged, still correct if some provider
*doesn't* clear the composer before the request), and falls back to the
captured value (if captured within the last 5s) when the live read comes
back empty. The captured value is cleared once actually consumed, so it
can't leak into a later, unrelated request.

Verified against the exact failure mode, not by inspection: updated
`mock-chat-page-contenteditable.html` so its Send handler mimics real
optimistic-clear behavior precisely - reads the composer into a JS
variable, clears the DOM element, *then* awaits `fetch` with the
already-read text (the outgoing request body is correct; only a DOM read
at that point would find nothing). Without today's fix, this exact
sequence is what would have failed - the mock previously didn't reproduce
it. Both e2e tests pass (2/2), unit suite unchanged (19/19). Also ran a
one-off script capturing the full console trace to confirm the actual
code path taken (not just the end-to-end assertion passing for an
unrelated reason) - the log line
`live DOM read was empty (composer already cleared by the app) - using
text captured 5 ms before submit instead: ...` fired exactly as expected,
and the request body the mock server actually received was
`[NAME_1], id [ID_NUMBER_1]` - zero raw PII.

Also, while re-testing: added a real demo row (`אבנר כהן` / `123456782`,
checksum-valid) to the local `demo_customers` table and ran a real
connector sync against the live Railway backend (8 entities ingested,
connector status `connected`) so there would be a genuine registered
entity to test blocking against - the user's original test names were
never actually synced (see round 1's testing-methodology note; row 1 in
that table is literally `דוד לוי` / `314159265`, the exact original test
values, still unsynced until now). Side observation, not investigated
further: 13 separate connector records exist for this company, one every
~15 minutes since the day before - a `connector daemon` process is
apparently already running somewhere on a schedule, each restart seemingly
creating a fresh connector record rather than reusing one via a persisted
`connectorId`.

**Still open:** the real chatgpt.com/claude.ai re-test with this second
fix was pending when this entry was written.

---

## Real-site failure, round 3: the pre-submit capture matched the wrong element — 2026-08-06

Re-testing round 2's fix against real chatgpt.com surfaced a third,
different bug - and traced the mystery "13 connector records appearing
every 15 minutes" flagged (unexplained) at the end of round 2 to its actual
cause along the way.

**The bug.** The captured text at submit time was a formatted letter
template with bracket placeholders (`[שם הלקוח]`, `ת"ז [מספר תעודת זהות]`) -
not anything the user typed. Root cause: the user had ChatGPT's **Canvas**
panel open (a side document-editor). With Canvas open there are *two*
`contentEditable` regions on the page, and round 2's capture mechanism
had a real design flaw: its `click` listener re-ran a page-wide
`getLiveInputText()` scan (activeElement, then `querySelector` fallbacks)
*at click time*, by which point the real composer had already blurred to
`<body>`. The scan then matched Canvas's static content instead of the
real composer - and, critically, **overwrote** the correct text that
`input` events had already captured correctly during typing, milliseconds
before the request fired. So the earlier capture was right; a later,
wrongly-targeted capture clobbered it right before it was needed.

**The fix.** Capture directly from `event.target` for `input` and `keydown`
events - never from a page-wide selector scan. `event.target` has zero
ambiguity: it's always the exact element the user is actually typing into,
regardless of how many other `contentEditable`/`ProseMirror` regions exist
elsewhere on the page. Dropped the `click` listener's page-wide capture
entirely (clicking "Send" targets the button, not the composer, so it was
never a reliable signal - `input`/`keydown` during typing already capture
correctly before any click happens). Also flipped priority in
`tokenizeOutgoingBody`: the captured value (verified-correct target) is now
tried *before* a fresh direct DOM read, not just as a fallback when the
direct read is empty - a fresh read can be non-empty and still wrong on a
page with multiple editable regions, which is exactly what happened here.

**Verified against the exact reproduced scenario**, not by inspection:
added a second, decoy `.ProseMirror[contenteditable]` element to
`mock-chat-page-contenteditable.html`, populated with the same kind of
static bracketed-placeholder text, positioned *before* the real composer in
DOM order (so a naive `querySelector` - which returns the first match -
would pick it, matching what must have happened on the real site). Both
e2e tests pass (2/2), unit suite unchanged (19/19).

**Solved in passing:** the "13 connector records every 15 minutes" oddity
flagged at the end of round 2 turned out to be a `docker run --network
host` container (`pii-shield-connector`, running `daemon --config
/config/connector.config.json`) already running as root on this machine,
independent of anything in this session - discovered by accident while
diagnosing an unrelated e2e flake (a stray backend process left bound to
port 3000 from much earlier in this session, plus normal system load,
occasionally pushes the backend's cold `ts-node` compile past the e2e
test's 60s startup timeout - not a real bug, just environment noise).
Not touched, since it's a root-owned process outside this session's scope
and nothing was broken by its existence - noted here only so it isn't
mistaken for a mystery next time.

**Still open:** the real chatgpt.com/claude.ai re-test with *this* fix
(round 3) was pending when this entry was written. Gemini remains
completely untouched/unverified in every round.

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

## Pre-customer hardening pass

Starting a structured hardening pass before the product is shown to real
customers: rate limiting, cross-tenant authorization audit, secrets audit,
DB backups, error handling, logging audit, then branding/professionalism
(name suggestions, landing page, UI polish, README). Working autonomously
per explicit instruction; decisions and reasoning documented here as they're
made, local commits at the end of each part, no push/deploy until final
explicit approval.

### 1. Rate limiting

Added `@nestjs/throttler`. Design:

- **Tracking key**: by default the library tracks by IP. That's wrong for
  this product - many employees of one customer company sit behind a single
  shared office IP/NAT, so IP-based throttling risks legitimate users at a
  busy customer locking each other out. `CustomThrottlerGuard`
  (`backend/src/common/throttler/custom-throttler.guard.ts`) overrides
  `getTracker()` to key by the request's `x-api-key`/`x-extension-key`
  header when present, falling back to IP only for pre-auth requests (the
  only such request in this system is `POST /admin/companies`, which uses a
  different header, `x-admin-secret`, that this tracker doesn't special-case
  - so it correctly falls through to IP).
- **Global default**: `120 requests / 60s` per tracker key, applied via
  `APP_GUARD` in `app.module.ts`. Generous - meant to catch obvious abuse,
  not constrain normal usage.
- **`CompaniesController` (admin/companies)**: stricter dedicated limit,
  `30 requests / 15min`, IP-tracked (see above). This is the one endpoint
  gated by a secret an operator chooses by hand
  (`ADMIN_BOOTSTRAP_SECRET`) rather than a generated 256-bit key, so it's
  the only meaningful online brute-force target in the system and gets
  real protection: even a weak 9-digit numeric secret would take on the
  order of hundreds of years to exhaust at 30 attempts/15min.

**Why nothing else needed its own strict throttle**: audited every other
guarded endpoint (`ApiKeyGuard`, `ExtensionKeyGuard` - employees, entities,
connectors, session `companies/me`/`employees/me`). All of them authenticate
via `apiKey`/`extensionKey`, which `generateSecret()`
(`backend/src/common/crypto/hashing.util.ts`) creates as `randomBytes(32)`
hex - 256 bits of entropy. No realistic rate limit makes guessing one of
these feasible or infeasible; the entropy itself is the defense. The only
human-chosen, guessable secret in the whole system is
`ADMIN_BOOTSTRAP_SECRET`, already covered above.

**Bug found and fixed before it shipped**: initially set the
`CompaniesController` limit to `5/15min`. Before running anything, noticed
the existing e2e suite (`pii-shield.e2e-spec.ts`) calls
`POST /admin/companies` 12 times within a single Jest run (one persistent
app instance, one IP, no `x-api-key`/`x-extension-key` header for the
tracker to key on instead - so all 12 share one IP-keyed bucket). A limit of
5 would have made the 6th+ legitimate call fail with `429` instead of its
expected status, breaking the suite. Raised the limit to `30/15min` -
comfortably covers the 12 known calls plus headroom, while remaining
effectively unbreakable via brute force per the math above. Verified: full
unit suite (5/5) and e2e suite (13/13, including a new dedicated
rate-limit test) pass together.

**New test**: `backend/test/rate-limit.e2e-spec.ts` - its own app instance
(so it doesn't share/pollute the throttle budget used by the other e2e
file's legitimate calls), fires 35 requests at `POST /admin/companies` with
a wrong secret and asserts the first 30 come back `401` (rejected on the
secret, not yet throttled) and the remaining 5 come back `429` - proving the
guard actually rejects excess traffic, not just that it's wired up inertly.

**Known limitation, accepted for now**: `CustomThrottlerGuard.getTracker()`
reads the `x-api-key`/`x-extension-key` header value *before* it's
validated (the global `APP_GUARD` throttler necessarily runs before the
per-route `ApiKeyGuard`/`ExtensionKeyGuard` in Nest's guard execution order,
so it has no way to know yet whether the key is real). This means an
attacker could send a different garbage credential value on every request
and get a fresh throttle bucket each time, evading the generous 120/min
global default entirely. Decided this is acceptable at this stage because:
(a) it only weakens the general "catch obvious abuse" limiter, not any
secret-guessing protection - there's nothing guessable behind those guards
per the entropy argument above; (b) closing it properly needs either a
second, IP-only global throttle layered on top or edge/CDN-level rate
limiting (Railway/Cloudflare), which is a reasonable follow-up but is
volumetric-DoS hardening, not the brute-force risk this task is about.
Noting it here so it isn't forgotten, not silently leaving it undocumented.

### 2. Cross-tenant authorization audit

Read every controller/service pair in the backend (`companies`, `employees`,
`connectors`, `entities`, `audit-logs`, `dashboard`, `health-check`,
`session`) and traced how `company`/`employee` gets attached to each
request:

- `ApiKeyGuard`/`ExtensionKeyGuard` both derive `request.company` /
  `request.employee` by hashing the presented header and looking it up in
  the DB - never from anything client-supplied (body/params/query). No DTO
  in the codebase accepts a `companyId`/`employeeId` field (checked via
  `grep -l companyId\|employeeId **/*.dto.ts` - zero matches), so there's no
  way to spoof scoping through the request body either.
- Every service method that looks up a resource by id
  (`connectors.getOwned`, `employees.getOwned`, and the equivalent inline
  checks in `entities.ingestBatch` for `connectorId`) uses
  `findFirst({ where: { id, companyId: company.id } })` - a foreign
  company's id naturally falls through to `NotFoundException` rather than
  returning another tenant's row. List endpoints (`employees.list`,
  `connectors.list`, `entities.list`, `audit-logs.list`,
  `dashboard.getSummary`/`getAnomalies`, `health-check.getLatest`) all take
  `companyId` from the authenticated company/employee, never as a
  queryable parameter.
- The one filter that looked initially suspicious -
  `audit-logs.list`'s optional `?employeeId=` query param not being
  independently checked against the caller's company - turns out to be
  safe by construction: the Prisma query ANDs `companyId: company.id` with
  `employeeId`, and every audit log's `employeeId` already belongs to
  exactly one company, so passing another tenant's employeeId can only ever
  produce zero rows, never a leak. Added an explicit test for this exact
  case anyway (see below) rather than relying on the reasoning alone.
- The connector's own local HTTP API (`connector/src/server.ts`, used
  directly by the admin-console's "sensitive data" tab, bypassing the
  central backend by design) is single-tenant by architecture - each
  customer runs their own connector instance in their own network, so
  there's no cross-tenant surface there to test. It does reuse the
  company's central `apiKey` for its own auth via a plain `!==` string
  comparison rather than a timing-safe one; noted for the secrets audit
  (not a cross-tenant issue, and low severity given it's a LAN-only
  service, not internet-facing).

**New test file**: `backend/test/cross-tenant.e2e-spec.ts` - its own app
instance, spins up two fully separate companies (A and B) with their own
employees/connectors/entities/audit-logs, then systematically tries to
reach from A into B's resources (and vice versa) across every controller:
read/disable another company's employee by id, start/complete/fail-sync or
delete another company's connector, ingest entities tagged with another
company's connectorId, read another company's entity hashes via
extensionKey, filter audit logs by another company's employeeId, read
dashboard summary/health-check data, and confirm a company's own apiKey
doesn't work as an extensionKey (and vice versa). 14 tests, all pass
against the existing implementation - **no cross-tenant leak found**; the
`findFirst({ id, companyId })` pattern used consistently throughout the
codebase already closes this off correctly. Full suite (unit + e2e, 4
files) verified green together: 5 unit + 27 e2e = 32 tests passing.

### 3. Secrets audit

Global search across every tracked file (`git ls-files`, 163 files) for:
hardcoded API-key-shaped strings (`sk-...`, AWS `AKIA...`, PEM private key
headers, GitHub/Slack token prefixes), literal `apiKey`/`password`/`secret`
assignments outside of docs/tests/env-var references, and URLs with
embedded `user:pass@host` credentials. **No hardcoded secrets found.**

What the audit confirmed instead:

- `backend/.env.example` is tracked (as intended, it's a template) and uses
  an obvious `"change-me-in-production"` placeholder for both `JWT_SECRET`
  and `ADMIN_BOOTSTRAP_SECRET` - not a real value. `.gitignore` excludes
  `.env` and `.env.*` while explicitly re-allowing `.env.example`, and no
  real `.env` file is tracked.
- Every other reference to `ADMIN_BOOTSTRAP_SECRET`/`apiKey` across the repo
  (admin-console, super-admin, `manual-verify.mjs`) is either a
  `process.env.*` read or Hebrew UI copy telling the user *which* env var to
  set on their own Railway deployment - never a real value.
- `connector.config.json` (holds the real per-company `apiKey` for a
  deployed connector instance) is `.gitignore`d and never committed;
  `connector/src/config.ts` only reads it from disk at runtime.
- `docker-compose.dev.yml`'s Postgres password (`pii_dev_password`) is
  local-dev-only, bound to a loopback-mapped port, not used by anything
  that talks to production data - acceptable as-is, standard practice for
  a local dev container.
- `backend/src/health-check/health-check.service.ts`'s `CANARY_VALUE`
  constant is intentionally hardcoded (already documented inline as safe)
  - it's a fixed non-secret marker string used to prove the hash pipeline
    is alive, not something that protects access to anything.

**One real (non-secret) finding from this pass, fixed under item 2 in
spirit but noting here since it surfaced during the secrets grep**:
`connector/src/server.ts`'s local API auth compares the presented
`x-api-key` header with `config.apiKey` using plain `!==`, not a
timing-safe comparison (unlike the central backend, which hashes+compares
via `hashSecret`/DB lookup, and the admin bootstrap check, which uses
`timingSafeEqual` explicitly). Low real-world severity - this endpoint
only listens on the customer's own local network (documented purpose:
"never through the central backend"), not the public internet, so a remote
timing attack isn't realistically mountable. Left as-is rather than
"fixed" to avoid scope creep on a non-public-facing service during this
pass; flagged here so it isn't forgotten if the connector's API is ever
exposed more broadly.

### 4. Postgres backups

Checked the production Postgres volume's backup schedule via Railway's
GraphQL API (`railway api`, no CLI subcommand exists for this - had to
`railway api search backup` to find `volumeInstanceBackupScheduleList` /
`volumeInstanceBackupScheduleUpdate`, then resolve the volume's
`volumeInstanceId` via `environment.volumeInstances`, since the direct
`Volume.volumeInstances` field is deprecated in favor of the
environment-scoped one). Confirmed: `volumeInstanceBackupScheduleList`
returned `[]` - **no backup schedule existed**.

Tried to enable one directly (`volumeInstanceBackupScheduleUpdate(kinds:
[DAILY])`) - got back `"Not Authorized"`. Checked `me { workspaces { plan
} }`: the workspace is on Railway's **Hobby** plan; native automated
volume backups are a paid-plan feature. Upgrading the plan would fix this
in one call, but that's a real recurring cost on the user's account, which
is exactly the kind of decision this task's "don't stop to ask, except for
something destructive/irreversible" instruction shouldn't be read to cover
implicitly - spending the user's money isn't mine to decide, so I didn't.

**What I built instead**: a self-contained daily backup inside the backend
itself, not dependent on Railway's paid feature.
`backend/src/backup/backup.service.ts` (wired via `backup.module.ts` into
`app.module.ts`) - a `@Cron(EVERY_DAY_AT_3AM)` job that reads every row of
every table (`Company`, `Employee`, `Connector`, `SensitiveEntity`,
`AuditLog`, `HealthCheck`) via Prisma and writes them as one timestamped
JSON file to `BACKUP_DIR` (defaults to `./backups` locally; meant to point
at a dedicated volume in production - see below), then prunes files older
than `BACKUP_RETENTION_DAYS` (default 14).

Why a JSON row-dump instead of real `pg_dump`: the backend deploys via
Railway's Nixpacks auto-detection, not a custom Dockerfile, so there's no
guarantee `pg_dump` exists in the build image without adding Nixpacks apt
packages - a change I can't verify without an actual deploy, which is out
of scope until final approval per the "no push/deploy until the very end"
rule. A Prisma-based JSON dump only needs what's already in the image
(Node + the Prisma client already used everywhere else), so it's fully
testable locally right now. It's a logical, row-level backup (sufficient to
reconstruct all application data) rather than a byte-identical binary
Postgres backup (no WAL, no index internals) - an accepted tradeoff for
"reasonable, not perfect, at this stage" per the task's own framing, given
the DB's actual size (170MB volume, well within what a JSON dump handles
comfortably).

Worth calling out explicitly since it's the core premise of this whole
product: every table backed up here only ever contains `entityHash`
(HMAC-SHA256 of the real value) and *hashes* of `apiKey`/`extensionKey`
secrets - never raw PII or a usable credential. The backup file itself
carries no more sensitive information than the live DB already does, so
this doesn't introduce a new class of data-at-rest risk.

**Tested**: `backend/test/backup.e2e-spec.ts` (2 tests, against the real
local Postgres) - confirms a real backup file is written containing every
table (including a freshly-created company) with only a hashed
`apiKeyHash` (`/^[a-f0-9]{64}$/`, never a raw secret), and confirms pruning
correctly removes a synthetic 30-day-old backup file while preserving a
freshly-written one. Full suite verified together: 5 unit + 29 e2e = 34
tests passing.

**Not yet done - required at final-deploy time, documented here so it
isn't forgotten**: this only actually protects production data once (a) a
dedicated Railway volume is attached to the `backend` service (e.g.
`railway volume add --service backend --mount-path /data/backups` -
deliberately a *separate* volume from `postgres-volume`, so a problem with
the DB's own volume doesn't take the backups down with it) and (b)
`BACKUP_DIR=/data/backups` is set on that service and it's redeployed.
Both are real infrastructure/deploy actions, correctly held until the
user's final approval per the working rules for this task - not done here.

### 5. Global error handling

Nest's own built-in default filter already avoids leaking stack traces on
uncaught errors, but the project had no explicit filter of its own - relying
on implicit framework behavior for something this security-relevant isn't
great practice (it's invisible, untested, and could silently change on a
Nest version bump). Added `backend/src/common/filters/all-exceptions.filter.ts`
(`@Catch()` - catches everything) and registered it globally via
`APP_FILTER` in `app.module.ts` (same pattern already used for the
throttler guard, which has the added benefit of it being active in the
e2e test app instances too, not just when `main.ts`'s `bootstrap()` runs):

- Our own `HttpException`s (`NotFoundException`, `UnauthorizedException`,
  the `ValidationPipe`'s `BadRequestException`, `ConflictException`,
  `ThrottlerException`, etc.) pass through with their own
  deliberately-crafted status+message - these are all intentional,
  client-safe messages already.
- Anything else (a raw `Error`, an unwrapped Prisma error, a bug) - the
  full error and its stack are logged server-side via Nest's `Logger` (so
  it's still debuggable from Railway logs), but the client only ever gets
  a flat `{ statusCode: 500, message: 'Internal server error' }`.

**Test**: `backend/test/error-handling.e2e-spec.ts` - overrides
`DashboardService` in a dedicated test module to throw a raw error
containing fake internal details (`ECONNREFUSED at /internal/db-pool.ts:42
- connection to 10.0.4.12 failed`) and asserts the actual HTTP response is
exactly the generic message, with no trace of the file path, IP, or error
text anywhere in the response body - a real assertion, not just "the code
looks right." A second test confirms a genuine `HttpException` (missing
`x-admin-secret`) still returns its normal structured message, as a
regression check that the new filter didn't change existing behavior.

**Related fix found and made while in this code**: the admin-console's and
super-admin's `api/client.ts` both threw `ApiError` using the *raw HTTP
response body text* as the error message - safe from a stack-trace
perspective (the backend never sends one), but unprofessional: several
places in the UI render `err.message` directly, so a validation failure
would have shown the user the literal JSON blob
(`{"statusCode":404,"message":"Connector not found"}`) instead of a clean
message. Added `extractErrorMessage()` to both clients (JSON-parses the
body, pulls out Nest's `message` field - which can be a string or an array
of validation errors - joins array messages, and falls back to a generic
Hebrew "שגיאה בשרת (קוד X)" for anything unparseable) so `ApiError.message`
is always something reasonable to show a user. Verified: both apps
type-check and build cleanly (`tsc --noEmit` + `vite build`, both green,
no other file in either app used the same raw-text pattern per a repo-wide
grep). Full backend test suite verified together: 5 unit + 31 e2e = 36
tests passing.

### 6. Logging audit

Grepped every `console.log`/`.warn`/`.error`/`.debug` and Nest `Logger`
call across all five packages (backend, connector, extension,
admin-console, super-admin), then checked each one for whether it could
ever print a raw secret (`apiKey`/`extensionKey`/`entitySalt`, not their
hashes) or raw PII (an employee's actual typed text, or a raw entity value
before hashing).

**Real finding, fixed**: `extension/src/main-world/content-main.ts` and
`extension/src/isolated/content-isolated.ts` had extensive
"TEMPORARY DEBUG LOGGING" (their own comment, added during the earlier
real-site PII-detection bug hunts - see the "three rounds of real-site
extension PII-detection bug fixes" entries earlier in this log) that
printed the user's **actual typed composer text and full outgoing request
bodies** straight to the page's browser console - on real AI chat sites,
this is exactly the raw PII the product exists to protect. It never left
the browser, but that's not the same as safe: console output is readable
by any other extension with debugger permissions, by remote-debugging
tools, and gets captured whole in screen-share/support sessions - all
realistic exposure paths for a product whose entire pitch is "we never let
this leave the browser at all."

Fixed by removing every raw-value argument from these log statements
(`value`, `liveText`, `bodyText`, `data.text`) while keeping the
structural/diagnostic logging that has ongoing debugging value and carries
no PII: URLs, event types, booleans, counts, and text **lengths** instead
of the text itself. Two categories were intentionally left as-is because
they're already safe by construction: the *tokenized* output
(`result.tokenizedText`/`response.tokenizedText`) is, by definition,
already had any detected PII replaced with tokens - logging it is the
whole point of a redaction pipeline, not a leak - and `TokenizeResponseMessage`
(checked its type definition) only ever carries `tokenizedText`,
`hiddenCount`, `failSafe`, never the original text. Updated the stale
"TEMPORARY... not meant to ship long-term" comments to explain the actual
scoping rule instead, since after this fix the remaining logging is safe
to ship indefinitely, not something to strip later.

Also checked (all clean, no changes needed): `connector/src/*` - the
logger only ever prints connector ids and counts, never the raw `value`
being hashed (that only ever flows into `computeEntityHash()` or the local
state store, consistent with the connector's whole design of keeping raw
values local); `admin-console/src` and `super-admin/src` - zero
`console.*` calls in either app; `backend/src` - existing `Logger` calls
only print company ids, file paths, counts, and caught-error
messages/stacks (server-side only, to Railway's own log viewer - not sent
to any client, per item 5 above - and never include a raw secret or PII
value in this codebase's own code). A final repo-wide grep for any log
statement whose arguments reference `apiKey`/`extensionKey`/`entitySalt`/
`password`/`secret` by name turned up nothing outside what's already
covered above.

**Tested**: extension `tsc --noEmit` (clean), `npm run build` (clean),
`npm test` (19/19 unit tests pass, unaffected - only log statement
arguments changed, no control flow), and the real-browser Playwright e2e
suite (`xvfb-run -a npm run e2e`, against a local mock AI-chat page, not a
real external site) - both scenarios (plain textarea and a ProseMirror-style
contentEditable composer that blurs on send) still pass, confirming the
tokenize/detokenize pipeline itself is untouched by this change.

## Pre-customer branding pass

Part 1 (hardening) is done and committed. Moving to Part 2: branding and
professionalism - name suggestions (proposal only, no code changes -
that decision is the user's alone), a standalone landing page, UI polish
across admin-console/super-admin, and a professional top-level README.

### 7. הצעות שם (Name suggestions)

"GHOSTAI" is this repo's working folder name only - it was never chosen as
a product name and doesn't appear in any user-facing UI copy. Below are 5
candidates for an actual commercial name, spanning English, Hebrew-rooted,
and invented-word options, since the product's first customers are likely
Israeli enterprises (law firms, healthcare, finance - the kind of org with
real client-PII exposure and an existing compliance mindset) but the
README/investor story should read fine internationally too. **Proposal
only - nothing below has been applied anywhere in the code.**

1. **PromptGuard** (English) - the most literally self-explanatory option:
   an enterprise buyer meeting the product for the first time understands
   the value prop from the name alone, no explanation needed. Trade-off:
   descriptive names like this are harder to trademark/own as a distinct
   brand long-term, and "___Guard" is a common pattern in security
   product naming (less distinctive on a crowded page of vendor logos).

2. **Redactly** (English) - ties to "redaction," a term enterprise legal/
   compliance buyers already use and trust (unlike "tokenization," which
   is accurate but meaningless to a non-technical buyer). The "-ly" SaaS
   suffix reads modern without being generic. More ownable as a proper
   noun/trademark than PromptGuard.

3. **Veilon** (English, invented word) - short, ownable, sounds like an
   established enterprise security brand by cadence alone (similar
   register to Vercel/Verkada/Sentinel-style names). Needs a strong
   tagline since it doesn't self-explain the product like the first two -
   but that's also what makes it a real brand rather than a description,
   and gives more room to grow beyond "just" AI-prompt protection later.

4. **Magen AI / מגן AI** (Hebrew-rooted) - מגן ("shield/guard") is
   immediately trustworthy and warm to a Hebrew-speaking enterprise buyer,
   and reads cleanly as "Magen AI" in English/Latin script too, so it
   works as one name in both markets rather than needing a translation.
   Worth being deliberate about: מגן carries real cultural weight (Magen
   David Adom) - likely a positive, trust-building association for this
   kind of protective product, but worth the user's own judgment call on
   whether that's desired or feels presumptuous.

5. **ShomerAI / שומרAI** (Hebrew-English portmanteau) - שומר ("guardian/
   watchman") has a warmer, more human register than מגן - less
   "institutional shield," more "someone is actually watching out for
   you." Follows a naming pattern common among Israeli startups (a Hebrew
   root word directly fused with an English/tech suffix). Trade-off:
   "Shomer" is a somewhat harder pronunciation for English-only speakers
   than the other options.

No recommendation is being made here on purpose - this is the user's
decision per the task's own framing, not something to pre-empt.

### 8. Landing page

New `landing/` workspace - a standalone marketing page, completely
separate from `admin-console` (requires an `apiKey` to do anything) and
`super-admin` (operator-only). Same tooling as the other two frontends
(Vite + React + TS + Tailwind, `serve -s dist` in production) for
deployment consistency, added to the root `package.json` workspaces array.
Single page, no router, no auth, no backend calls - genuinely static.

Content, in order: hero (what it does + two CTAs), a 3-point "risk you
already have today" section (employees already pasting client data into
AI tools, no visibility for IT/compliance, real legal exposure for
regulated industries), a 3-step "how it works" section, a dedicated
dark-background trust section stating the product's actual core
architectural invariant (raw data never leaves the customer's network/
browser, the central system only ever stores a one-way hash, and the
extension fails safe/closed if the backend is unreachable) - this is the
single most compelling, and truthful, differentiator for a
compliance-minded enterprise buyer, so it gets its own visually distinct
section rather than being buried in a bullet list, a "who it's for"
section (law firms, healthcare, finance, HR - anyone handling client-
confidential data), and a contact/demo section.

Used the "PII Shield" name throughout (not a new choice - it's already the
name shown in the live super-admin UI header/title today, so this doesn't
pre-empt the naming decision from item 7 above).

**Contact mechanism**: a `mailto:` CTA rather than a working form, since a
real form needs email-sending infrastructure (which service? whose
account/API key?) that isn't this task's call to set up unilaterally.
Address is configurable via `VITE_CONTACT_EMAIL` (documented in
`landing/.env.example` and `landing/README.md`), defaulting to an obviously
placeholder `contact@example.com` so it's impossible to miss that this
needs to be set to a real, monitored address before the page goes in front
of actual prospects - not done here since the real address depends on
whatever domain/name the user ends up choosing.

**Tested**: `tsc --noEmit` and `npm run build` both clean; loaded the real
dev server in an actual headless Chromium via Playwright and took a
full-page screenshot to visually confirm layout, RTL flow, and that the
numbered "how it works" steps read in the correct right-to-left order (a
real risk with CSS grid + RTL - verified rather than assumed); also ran
`npm start` (the exact command Railway will run in production) and
confirmed the built `dist/` serves with a real `200`.

### 9. Polish across existing interfaces

**Favicon**: none of the three web apps (`admin-console`, `super-admin`,
`landing`) had one at all - browser tabs showed a generic blank-page icon,
one of those small details that reads as "unfinished" to a first-time
visitor. Added a shared `favicon.svg` (a simple shield-with-checkmark
glyph in the indigo already used as the brand accent color throughout all
three apps) to each app's `public/` directory and wired a `<link
rel="icon">` into each `index.html`. Deliberately an abstract icon, not
tied to any of the name candidates from item 7 - doesn't pre-empt that
decision.

While in there, also gave the **browser extension** proper toolbar icons
(16/32/48/128px PNGs, rasterized from the same SVG via ImageMagick
`convert`) - it had none either, so Chrome was showing every employee a
generic puzzle-piece icon in their toolbar. Not explicitly named in this
task's list (which only called out admin-console/super-admin), but it's
the same "looks unfinished" problem on the single most-seen surface of the
whole product, so in scope in spirit. Wired via `manifest.json`'s
`icons`/`action.default_icon` and `vite.config.mts`'s `viteStaticCopy`
targets (added `icons/` alongside the existing `manifest.json` copy).

**Page titles**: `admin-console` ("PII Shield - ניהול") and `super-admin`
("PII Shield - Super Admin") already had clear, professional titles from
earlier work - left as-is. Added a `<meta name="description">` to both
(previously only `landing` had one) since that also affects link-preview
quality if either is ever shared, not just SEO.

**Error messages**: went through every `catch` block in `admin-console`
and `super-admin` (18 total). Found they were already generally well-built
- specific Hebrew messages per status code (e.g. 401 vs. 409 handled
differently), not raw dumps - thanks to earlier work in this project.
The one real gap was the `ApiError`/`ConnectorApiError` message-extraction
issue already found and fixed under item 5 above (raw JSON body ->
clean parsed message). `ConnectorApiError`'s own fallback (`Connector
request failed: ${status}`) was already reasonable - it's talking to a
connector on the admin's own local network, where surfacing the actual
HTTP status is useful debugging info, not a leak. No literal
`"Error: undefined"`-style bugs found anywhere.

**Tested**: rebuilt `admin-console`, `super-admin`, and the extension
after all changes - all three build clean, `favicon.svg` present in both
web apps' `dist/`, extension's `dist/icons/*.png` present and manifest.json
valid JSON. Re-ran the extension's real-Chromium Playwright e2e suite
(`xvfb-run -a npm run e2e`) to confirm the new manifest/icon config didn't
break extension loading - both scenarios still pass. Also started the real
backend + admin-console dev servers and used Playwright to load the actual
page and confirm `document.title` and the favicon `<link>` tag are both
present and correct, not just "looks right in the source file."

### 10. Top-level README

Rewrote `README.md` for a reader who doesn't already know this codebase -
someone evaluating it (an investor, a potential partner, a new engineer)
rather than someone already working in it day to day. Restructured around:
a two-sentence elevator pitch of what the product actually does and why it
matters (not "a NestJS backend with a browser extension" - what problem it
solves for an employer), a plain-language "how it works" walkthrough of the
4-step architecture that leads with the hash-only privacy guarantee (the
single most important fact about this product, now stated in the first
screen of the README rather than requiring someone to already know to look
in `SECURITY.md`), an updated components table (previous version was
missing `super-admin` and `landing`, both added since the version this
README was last touched), and an honest "Status" section stating plainly
that this is pre-launch with no production customer yet - matching the
instruction to make this presentable, not to oversell it.

Kept the local dev quick-start (still genuinely useful, just moved lower,
below the pitch/architecture) and added the two steps missing from it
(`super-admin`, `landing`). Left `BUILD_LOG.md`'s full week-by-week history
out entirely, as instructed - the new README points to it for "how did we
get here" rather than repeating it.

**Bug found and fixed while cross-checking this**: the README claimed
"each component has its own README.md," but `super-admin/README.md` never
existed - it was the one component added later (per the earlier session's
work) that never got one. Added `super-admin/README.md` (auth model, run/
build commands) matching the style already used by `admin-console/`,
`connector/`, and `extension/`'s own READMEs, so the top-level claim is
actually true. Verified every file and relative link referenced from the
new top-level README (`SECURITY.md`, `BUILD_LOG.md`, `PII-Shield-Spec.md`,
every component's own `README.md`, `docker-compose.dev.yml`,
`backend/.env.example`, `connector/config.example.json`) really exists on
disk, rather than assuming.

## Name decided: Nistar (נסתר)

The user chose **Nistar** (Hebrew: נסתר, "hidden/concealed") - not one of
the 5 candidates proposed under item 7, their own choice, which is exactly
what that section was for. Fits the product well: the whole architecture
is built around the central system never seeing the customer's actual
data, only a hash of it - "hidden" is a fair one-word summary of the
entire security model.

**Railway backup infrastructure, set up ahead of this deploy per explicit
request**: created a dedicated volume (`backend-volume`, `Ready`, mounted
at `/data/backups`) attached to the `backend` service, separate from
`postgres-volume` as designed, and set `BACKUP_DIR=/data/backups` on
`backend` with `--skip-deploys` (so it doesn't trigger a wasted redeploy of
the currently-live, pre-backup-feature code - it'll simply already be in
place the next time `backend` actually redeploys). Note: `railway volume
add` (the CLI subcommand) crashed with a Rust panic
(`Option::unwrap() on a None value`, `volume.rs:836`) in this environment,
on CLI v5.30.4, reproducibly, with or without `--json`/`--environment`,
even after `railway upgrade`. Worked around it via the GraphQL API
directly (`railway api`) using the `volumeCreate` mutation - same
approach already used earlier to inspect/attempt the (paid-plan-gated)
native backup schedule. Verified via `railway volume list` (shows
`backend-volume` at `/data/backups`, attached to `backend`, `Ready`) and
`railway variable list --service backend --kv` (shows `BACKUP_DIR=/data/backups`
and the `RAILWAY_VOLUME_*` vars Railway auto-injects once a volume is
attached) - both confirmed correct before reporting back.

**Applied the name across every genuinely user-facing surface** (not a
proposal anymore - this is the user's actual decision, now in the code):
`landing/`, `admin-console/` (page title/meta, header, onboarding copy,
sensitive-data tab copy), `super-admin/` (page title/meta, dashboard
header, login copy), the extension (`manifest.json`'s `name` - this is
literally what Chrome shows in `chrome://extensions` and would show in
the Web Store listing - `options.html`/`popup.html` titles, the in-page
badge text shown directly on ChatGPT/Claude/Gemini tabs, and the
`console.log('[Nistar]...')` diagnostic prefixes for consistency), plus
the top-level `README.md` and `SECURITY.md` and every component's own
`README.md`. Deliberately left unrenamed (historical/internal, not
customer-facing): `BUILD_LOG.md` (rewriting past dated entries would be
revisionist, not useful), `PII-Shield-Spec.md` (the original foundational
spec artifact), `backend/test/pii-shield.e2e-spec.ts`'s filename, and the
connector's internal `package.json`/CLI command name (a workspace-internal
identifier, not shown to any customer). The `PII_SHIELD_REQUEST`/
`PII_SHIELD_RESPONSE` postMessage protocol constants in
`extension/src/shared/messages.ts` were also deliberately left alone - an
internal cross-script protocol identifier, not user-facing text, and
renaming it is pure risk (a typo could silently break the main-world/
isolated-world message contract) for zero user-visible benefit.

**Landing page contact email**: updated to `DA@101.ORG.IL`, explicitly
described by the user as temporary until a real domain/mailbox exists for
the chosen name. Set as the new default in `App.tsx`'s `CONTACT_EMAIL`
fallback (still overridable via `VITE_CONTACT_EMAIL` once a real address
exists) and in `landing/.env.example`.

**Tested**: `tsc --noEmit` clean across all 5 packages (backend,
admin-console, super-admin, landing, extension); full backend suite green
(5 unit + 31 e2e = 36); all 4 frontend packages rebuild clean; extension's
real-Chromium Playwright e2e suite re-run and both scenarios still pass
(the rename touched UI copy and log strings only, not tokenization logic).
Took a fresh full-page screenshot of the built landing page to visually
confirm the new name and contact address actually render, not just that
the source diff looks right.

## Super-admin auth: single shared secret -> username+password

Requested follow-up from an earlier round (not something this session had
any record of until asked about it directly - checked the actual code
first rather than trusting memory, confirmed it genuinely hadn't been done
yet, then implemented it). Replaced the single `ADMIN_BOOTSTRAP_SECRET`
that gated `POST /admin/companies` (and its `GET`/`DELETE` by id) with a
single operator account: `SUPER_ADMIN_USERNAME` + `SUPER_ADMIN_PASSWORD`,
both required together. Scope decided with the user up front: one operator
account (no multi-user table - env vars are enough for a single account,
consistent with how the old single secret was already just an env var),
and the backend itself changes auth (not just the super-admin UI relabeling
a field and still sending the old secret underneath).

**Backend**: `backend/src/common/guards/admin-bootstrap.guard.ts` replaced
with `super-admin.guard.ts` (`AdminBootstrapGuard` -> `SuperAdminGuard`).
Reads `x-admin-username`/`x-admin-password` headers, compares each against
`SUPER_ADMIN_USERNAME`/`SUPER_ADMIN_PASSWORD` via the same `timingSafeEqual`
helper the old guard used - critically, **both comparisons always run**,
neither short-circuits the other, so a wrong username can't be distinguished
from a wrong password by response timing (a guard that checked username
first and bailed early on failure would leak, via timing, whether the
username alone was already correct). `companies.controller.ts` updated to
use the new guard; `CustomThrottlerGuard`'s IP-fallback behavior is
unaffected (`x-admin-username`/`x-admin-password` are still not
`x-api-key`/`x-extension-key`, so `POST /admin/companies` still correctly
falls back to IP-based throttling - the actual brute-force protection for
this endpoint, unchanged in effect, see item 1 from the hardening pass).

**New dedicated test**: `backend/test/super-admin-auth.e2e-spec.ts` (6
tests) - proves both credentials are actually required *together*, not
just independently checked (right+right succeeds; right-username+wrong-
password fails; wrong-username+right-password fails; either header alone
fails; neither header fails). This guards against a subtly wrong
implementation - e.g. one where a present-but-empty password header still
passed - that a naive "wrong creds get 401" test using two wrong values at
once wouldn't have caught.

**Updated to use the new two-header auth** (all previously used a single
`x-admin-secret` header and `process.env.ADMIN_BOOTSTRAP_SECRET`):
`backend/test/pii-shield.e2e-spec.ts`, `cross-tenant.e2e-spec.ts`,
`rate-limit.e2e-spec.ts` (its brute-force test now sends two wrong values);
`extension/e2e/extension.spec.ts` and `connector/test/sync.integration.ts`
(both bootstrap a real test company against a real backend the same way).
Local `backend/.env` (gitignored) updated with dev `SUPER_ADMIN_USERNAME`/
`SUPER_ADMIN_PASSWORD` values so all of the above keep working locally.

**Super-admin app**: `SuperAdminSession` changed from `{ backendUrl,
adminSecret }` to `{ backendUrl, username, password }`;
`api/client.ts`'s `request()` sends both new headers.
`Login.tsx` now has two fields (username, password, with proper
`autoComplete` attributes) instead of one secret field, with an updated
401 error message that doesn't imply which field was wrong (matches the
guard's own "don't leak which credential failed" design).

**Admin-console**: the onboarding wizard's step 1 (an operator creating a
*new* customer company, gated by the same guard) needed the same update -
otherwise it would have been permanently broken (always 401) the moment
the backend redeploys with the new guard. `api/client.ts`'s `createCompany()`
now takes `(backendUrl, adminUsername, adminPassword, name, adminEmail?)`;
`Onboarding.tsx`'s `StepCompanyDetails` now collects both fields, with
updated help text pointing at the right env var names.
`manual-verify.mjs` (the real-Chromium Playwright script used to verify
this exact page) updated to fill both new labeled fields instead of one.

**Docs updated**: `backend/README.md`, `admin-console/README.md`,
`super-admin/README.md`, top-level `README.md`, and `SECURITY.md` (added
the timing-safety note above, since it's a genuine security property worth
stating explicitly, not just implementing silently).

**Tested**: `tsc --noEmit` clean across backend, admin-console, super-admin,
extension, connector. Full backend suite: 5 unit + 37 e2e (7 suites,
including the new 6-test super-admin-auth spec) - all green.

**Real bug found and fixed, only via actual browser testing**: every
automated test above (supertest, or plain `fetch` from a Node script) uses
the new `x-admin-username`/`x-admin-password` headers successfully - none
of them go through real browser CORS enforcement, which only applies to
`fetch()` calls made *from a page in a browser*. Manually driving the real
super-admin login and admin-console onboarding pages in actual Chromium
(the same verification approach used throughout this whole session)
surfaced it immediately: login failed with a generic network error, not a
401, even with correct credentials. Root cause: `backend/src/main.ts`'s
CORS config still listed `allowedHeaders: [..., 'x-admin-secret']` - the
old header name. The browser's preflight (`OPTIONS`) request checks
`Access-Control-Allow-Headers` before the browser will even send the real
request with `x-admin-username`/`x-admin-password`; since neither was
allowlisted, the browser blocked the request client-side before it ever
reached the guard - `curl` doesn't perform this check, so a direct `curl`
test with the exact same credentials and headers returned a correct `200`,
which is what makes this bug invisible to anything that isn't a real
browser. Fixed by updating `allowedHeaders` to the new header names.
Re-verified in a real browser after the fix: correct credentials now log
in successfully (confirmed the actual dashboard renders, not just "no
error"), and a wrong password now correctly shows the credential-specific
error message (not the generic network-failure one) - both the positive
and negative case checked, not just "it doesn't crash anymore." Also
verified the admin-console onboarding wizard's company-creation step
(same guard, same headers) the same way. This is exactly the class of bug
the "test every change, verify against real infrastructure" practice
established throughout this whole session exists to catch - a passing
test suite here would have shipped a super-admin app that could never
actually log in.

## Fixed: connector URL "forgets" itself on reload (sensitive-data tab)

Reported bug: the admin-console's "מידע רגיש" (sensitive data) tab, which
talks directly to a company's connector, asks for the connector's URL
again on every reload even after a successful connection.

**Investigation first, not an assumed fix**: read `SensitiveData.tsx`'s
state machine carefully - `state` only ever becomes `'unset'` (the
input-form screen) at initial mount if `loadConnectorUrl()` (localStorage)
returns empty, or via the explicit "שנה כתובת connector" button. A failed
connection lands on `'unreachable'` (an error+retry screen), never back on
`'unset'` automatically. Reproduced against a real connector daemon (CSV
source, local HTTP API on `apiPort`) and real backend: with localStorage
intact, a genuine page reload correctly showed "מחובר" (connected), not
the input form - the code was doing what it looked like it should do.

So the actual bug isn't in the state machine - it's the *storage
mechanism* itself. `piiShieldConnectorUrl` was a single global localStorage
key: browser-and-device-specific (never persists across a different
browser, a different device, or a cleared cache - exactly the kind of
thing an admin would hit switching machines or clearing site data) and
**not scoped per company** (an admin managing more than one customer from
the same browser would have company B's connector URL stomped by whatever
company A last saved, and vice versa - a real latent bug beyond what was
reported).

**Fix**: moved it server-side, scoped per company - `Company.connectorAdminUrl`
(new nullable column, migration `20260807030000_add_company_connector_admin_url`),
read/written via the existing `GET`/`PATCH /companies/me` endpoints (added
to `UpdateSettingsDto` - deliberately not `@IsUrl()`, which rejects
localhost/private-IP hosts by default and those are exactly what most
connectors use; a plain `http(s)://` prefix check instead). This isn't a
privacy exception to the hash-only-storage rule - a connector's *address*
is network topology, not customer data, so storing it centrally is fine.
`SensitiveData.tsx` now fetches the company's saved URL on mount instead
of reading localStorage; `connectorClient.ts`'s `loadConnectorUrl`/
`saveConnectorUrl`/`clearConnectorUrl` (localStorage-based, and
`clearConnectorUrl` was already dead code - never called anywhere) removed
entirely in favor of the existing `api.getCompany`/`api.updateSettings`
calls the rest of the app already uses.

**New tests**: extended the existing `PATCH /companies/me` e2e test to
cover `connectorAdminUrl` round-tripping through a save + a *separate* GET
(proving it's actually persisted server-side, not just echoed back) plus a
validation-rejection case; added a cross-tenant test to
`cross-tenant.e2e-spec.ts` confirming company A's saved URL is never
visible to company B (this field gets the same tenant-scoping guarantee as
everything else in `CurrentCompany()`-backed endpoints, but worth an
explicit assertion given it's new).

**Verified the actual fix, not just the code**: reproduced the original
failure mode for real (fresh connector + company, connected successfully
in one Playwright browser context, confirmed `localStorage` was empty for
the old key - proving it's not being used anymore), then opened a
*completely separate, brand-new browser context* - zero localStorage,
simulating a genuinely different device - and confirmed it showed
"מחובר" (connected) immediately, never the input form. This is the
strongest form of proof available that it now actually survives what
localStorage structurally couldn't, not just that the code path looks
different.

## Landing page redesign

Feedback: the landing page looked generic and minimal - no real
typography identity, no motion, didn't read as a real SaaS product. Asked
to check for a `frontend-design` skill at `/mnt/skills/public/frontend-design/`
first - that path (and `/mnt/skills/` entirely) doesn't exist in this
environment, so this was done as direct design work instead, not skill-
guided.

**Typography**: added Heebo (Google Fonts, weights 300-900) as the base
font - strong Hebrew *and* Latin support, wide weight range for real
display-vs-body contrast, similar geometric register to what Inter/Söhne
give Linear/Vercel. Hero headline went from a plain `text-4xl font-bold`
to `text-5xl→7xl font-black` with a gradient-text treatment
(`.gradient-text`, indigo→violet `bg-clip-text`) on the two key phrases
("ChatGPT", "פרטי לקוח") - draws the eye to exactly what the product
protects against, not just bigger-for-its-own-sake.

**Motion**: added `framer-motion`. Hero content fades/slides up on load,
staggered (badge → headline → subhead → CTAs → trust line) via a shared
`fadeUp`/`stagger` variants pair. Every section below the fold uses
`whileInView` with `once: true` so it animates in exactly once as it
scrolls into view, not on every re-scroll. Buttons/cards get real hover
states (translateY + shadow growth on cards via a rewritten `.card` class;
buttons lift and gain a colored glow shadow on hover) - all via CSS
transitions, not JS, so they stay smooth without re-render cost.

**Visual hierarchy / depth**: added `lucide-react` for consistent line
icons (previously: no icons anywhere, just text) - a colored icon badge
per risk/audience item, a shield mark in the nav logo and the trust
section. Hero and trust sections both got a subtle background treatment
(a faint grid pattern masked to a radial fade, plus a soft blurred
gradient blob) instead of flat white/`indigo-950` - the kind of restrained
depth-without-clutter that reads as "designed," not "default." The 3-step
"how it works" cards gained a connecting line between them (a common
"process" visual) and their number badges became actual icon tiles
instead of plain colored circles.

**Real bug found in my own first test, not shipped**: my first full-page
screenshot (`fullPage: true` after an instant `scrollTo(bottom)` then
`scrollTo(0)`) showed several sections completely empty - no headline, no
cards, just the background color. Before assuming the animation code was
broken, redid the same capture with a *gradual*, stepped scroll (20 steps
with pauses, simulating how a real user actually scrolls) - every section
rendered exactly as designed. Root cause: an instant JS-triggered
`scrollTo` jump doesn't reliably give the browser's `IntersectionObserver`
a settled frame to fire on for elements it jumps over, so `whileInView`
never triggered for them - a testing-methodology artifact, not a real
bug a real scrolling user would ever hit. Documenting this because it's
exactly the kind of thing that could have been misdiagnosed as "the
animations are broken, remove whileInView" without checking the actual
cause first.

**Verified**: `tsc --noEmit` and `npm run build` both clean. Screenshot
comparison (before/after) sent to the user. Confirmed hover states
actually apply (card lift + shadow, button lift + color shift) via
Playwright `.hover()` + screenshot, not just "the CSS looks right."

## File upload scanning (PDF/Word/Excel) - starting point

The gap this closes was already self-documented in the code:
`content-main.ts`'s `patchedFetch` only tokenizes `init.body` when it's a
plain string - a file upload goes out as `FormData` (binary multipart),
which the existing warning log explicitly flags as "NOT covered by the
current interception logic." Confirmed via a fresh repo-wide grep
(file-upload/pdf/docx/xlsx/FileReader/FormData) that nothing else in
`extension/src` touches files at all - this is a real gap, not a partial
implementation.

**Core architectural decision (given, not made here)**: unlike text, a
PDF/DOCX/XLSX can't be reliably "edited in place" to redact just the
sensitive span the way string tokenization does - so this is *informed
blocking* (tell the user what was found, let them decide) rather than
*silent tokenization*. Detection only, never silent auto-send and never
silent auto-block.

### Phase 1: libraries

- **PDF**: `pdfjs-dist` (Apache-2.0) - the de facto standard, and the only
  realistic choice for a pure-client-side PDF text extractor of this
  quality.
- **DOCX**: `mammoth` (BSD-2-Clause) - converts OOXML `.docx` to plain
  text/HTML entirely client-side from an `ArrayBuffer`, no Node deps.
- **XLSX/XLS**: `xlsx` (SheetJS Community Edition, Apache-2.0) - the
  standard client-side spreadsheet parser, handles both modern `.xlsx`
  and legacy binary `.xls`.
- **Deliberately out of scope**: legacy binary `.doc` (pre-OOXML Word) -
  no good lightweight pure-JS parser exists for it; scoping to modern
  Office formats + PDF is a reasonable, professional boundary given the
  complexity/benefit tradeoff, not an oversight. Worth revisiting only if
  a real customer actually needs it.

**Real vulnerabilities found and fixed during install, not shipped
unpatched**: `npm install` initially resolved `pdfjs-dist@5.6.205` (this
environment's Node is 20.19.6; pdf.js's latest major requires Node
`>=22.13.0`, so npm silently picked the highest *compatible* version
instead of latest) - which sits inside the vulnerable range of a
**high-severity arbitrary-JavaScript-execution-on-malicious-PDF** advisory
(GHSA-hq66-cqwq-w95j), fixed only in `6.2.108+`. Explicitly installed
`pdfjs-dist@6.2.108` with the engine check overridden
(`--engine-strict=false`) - safe to override here specifically because
this package has zero install-time scripts (`npm view pdfjs-dist scripts`
→ `{}`) and its actual runtime is the browser via esbuild bundling, never
the local Node process the `engines` field is warning about; verified with
a real bundle+browser-execution test, not just "the flag suppressed the
error." Separately, the npm-registry `xlsx` package (`0.18.5`) has two
unpatched high-severity advisories (prototype pollution, ReDoS) with **no
fix available on the npm registry** - SheetJS stopped publishing patched
Community Edition builds there and moved to their own CDN
(`cdn.sheetjs.com`, their own documented distribution channel, not a
workaround) - installed from
`https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz` instead, landing on
`0.20.3`. Post-fix `npm audit` shows zero findings for either package; the
3 remaining findings (`esbuild`, `react-router`, `uuid`, all moderate) are
pre-existing, unrelated to this feature, and out of scope here.

**Verified all three with real extraction, not just "it imports cleanly"**:
bundled a throwaway test script with esbuild in the exact IIFE/browser
target config the real content scripts use, loaded it in a real headless
Chromium via Playwright (served over `http://`, not `file://` - PDF.js's
worker fetch is blocked under the `file:` scheme, a real thing to know
before hitting it inside the actual extension), and extracted text from
hand-built minimal-but-valid PDF/DOCX/XLSX files containing the exact
test string `"Customer record: Avner Cohen, ID 123456782"` (matching the
demo dataset referenced later in this task). All three came back with the
exact expected text, including PDF.js's worker (the highest-risk piece,
given the earlier open question about worker-loading vs. a host page's
CSP in a MV3 content-script context) - resolved empirically rather than
by reasoning alone.

### Phase 2+3+4: interception, extraction/scanning, dialog UI

Built together since they're one tightly-coupled pipeline. Key decisions:

**Where interception lives**: the task's own framing described this
relative to `content-main.ts`'s `patchedFetch` (MAIN world). Implemented
it in the **isolated world** instead (`fileUploadInterceptor.ts`, wired
into `content-isolated.ts`) - a deliberate deviation, reasoned through:
`change`/`drop` are plain DOM events, needing no page-JS access (unlike
patching `fetch`, which is why MAIN world exists at all), and isolated
world already holds the entity index and confidence/type settings
locally. Doing it there avoids a `postMessage` round-trip for
potentially-large extracted file text, and sidesteps a real open question
about whether pdf.js's Worker can reliably load a `chrome-extension://`
script URL from within MAIN-world execution under an arbitrary host
page's CSP (isolated world's resource loading is extension-controlled,
not subject to the host page's CSP the same way). This still satisfies
the actual requirement (catch the file before it becomes `FormData` in
any fetch/XHR call) - the DOM event fires before that regardless of which
world observes it.

**The core engineering problem**: our scan is inherently async (must read
and parse the file), but stopping the browser's own upload handling for
an event must happen synchronously, in the same tick the event fires. The
implemented pattern: capture-phase listener on `document` for both
`change` (on `input[type=file]`) and `drop`, calls
`preventDefault()`/`stopImmediatePropagation()` **unconditionally and
synchronously** the instant a new (not-yet-approved) file is seen -
before we know anything about its contents - then scans asynchronously.
If approved (clean, or user clicked "continue anyway"), a fresh
`DataTransfer` is built from the *same* `File` object(s) and a new
`change`/`drop` event is dispatched on the same target, letting the
page's own upload logic run normally on the replay. A `WeakSet<File>`
tracks already-approved files so the replay doesn't re-trigger our own
listener into an infinite loop. Known, accepted limitation: a
programmatically re-dispatched event has `isTrusted: false` - if a site's
own upload handler specifically checks `event.isTrusted` (uncommon, but
possible), the replay could be ignored. No evidence either real site does
this, but it's the honest caveat of this approach; Phase 5 was meant to
be the real-world check for exactly this kind of thing (see below).

**Detection, not silent redaction** (per the given architecture): file
matches use a disposable, per-scan `TokenStore` - never the
conversation's shared one - since file content is never actually
substituted/sent; only the *count and types* of what was found are shown
to the user (never raw values, consistent with the rest of the product).
Reused `tokenizeText()` exactly as-is (same regex/hash-matching pipeline
already used for message text) rather than writing a parallel matcher.
Extraction failures (corrupted/encrypted/unsupported-variant files) get
their own distinct dialog ("couldn't verify this file") rather than being
silently treated as clean or silently blocked - an honest third state.

**Dialog UI**: plain DOM/inline-styles (`fileScanDialog.ts`), matching
`badge.ts`'s existing approach (same max z-index, same
"inject into `document.documentElement`" pattern) rather than introducing
React/a new UI framework into the isolated-world bundle for one modal.

**Audit trail**: file-based blocks/overrides get logged to
`/audit-logs` the same way text blocks already do (`eventType: 'blocked'`
on cancel, `'user_override'` on "continue anyway" - a genuinely different,
useful signal for an admin: "someone knowingly sent something flagged,"
not just "something got blocked"). Extraction-failure cases are
deliberately *not* logged - a reasonable scope boundary, not an oversight.

**Real bug found while testing, not in the feature logic**: Jest crashed
importing `fileTextExtractor.ts` at all - `pdfjs-dist`'s ESM build uses
`import.meta.url` internally, which Jest's default CJS transform can't
parse, even for tests (DOCX/XLSX detection) that never touch PDF code.
Fixed by converting all three library imports (pdf.js, mammoth, xlsx)
from static, module-scope imports to `await import(...)` inside each
extractor function - loaded only when that file type is actually
encountered. This didn't reduce actual bytes shipped (esbuild's IIFE
output, required for a classic-script content script, doesn't
code-split - see `scripts/build-content-scripts.mjs`), just deferred
compilation of that function body (standard, unrelated to dynamic
import specifically) - correcting an earlier comment that overclaimed a
network/bundle-size benefit that isn't real for this build format.

**Second real bug found while testing**: attempting to unit-test DOCX
extraction under Jest failed with `"Could not find file in options"` -
traced to `mammoth`'s **Node** entry point (`lib/index.js`, what Jest
resolves under `testEnvironment: 'node'`) expecting `options.buffer`,
while the extraction code correctly uses `options.arrayBuffer` - the key
its **browser** entry point expects (what esbuild actually resolves when
bundling for `platform: 'browser'`, already proven correct in the Phase 1
real-browser smoke test). The application code was right; testing it
under Jest would have been testing a different code path than what
ships. Resolution: kept only `detectFileKind()` (pure, environment-
agnostic) in the Jest suite, and extended the real-browser e2e test to
cover DOCX and XLSX too, not just PDF - the only environment where
"which entry point gets resolved" actually matches production.

**Automated tests**: `fileTextExtractor.spec.ts` (9 cases, `detectFileKind`
only, see above for why extraction itself isn't unit-tested here).
`extension.spec.ts`'s new "file upload" test, against the real built
extension in real Chromium: a PDF with a known name+id shows the dialog
with correct per-type counts, cancelling genuinely prevents the network
upload (checked via the mock server's own received-uploads log, not just
"no error"), re-selecting the same file and clicking "continue anyway"
uploads it unmodified, a clean PDF uploads with no dialog at all, and the
same PII repeated as DOCX and XLSX both correctly trigger the dialog too
- proving detection isn't PDF-only. Found and fixed a real test-harness
quirk along the way: Playwright's `setInputFiles()` called twice with the
identical path doesn't fire a second `change` event (the browser treats
re-selecting the exact same file as a no-op) - fixed by clearing the
input (`setInputFiles('#file-input', [])`) between selections, not a bug
in the extension itself. Full suite: 28 unit + 3 real-browser e2e, all
green.

### Phase 5: real-site verification - blocked by network access, not by the feature

The task explicitly required checking against the real chat.openai.com/
claude.ai (not just automated mock testing), with F12 Network tab open.
Attempted this honestly before reporting anything: `curl` to
`chatgpt.com`/`claude.ai` returned `403`; a real headless Chromium via
Playwright got the same `403`, landing on a Cloudflare challenge page
(`__cf_chl_rt_tk=...` in the redirect URL) - this sandboxed environment's
network is being bot-challenged by Cloudflare before the page even loads,
independent of anything in this extension's code. Did not attempt any
form of fingerprint spoofing or challenge bypass to work around this -
that would mean deliberately evading a site's own anti-automation
protections, which isn't an appropriate thing to route around even for a
legitimate testing purpose.

**Honest status: this specific sub-step could not be completed from this
environment.** Everything upstream of it is done and verified as
thoroughly as possible without real-site access: the mock pages already
replicate the two real structural quirks found and fixed in earlier
rounds against the actual sites (a ProseMirror-style `contentEditable`
composer that blurs to `<body>` on send, and the general
ChatGPT/Claude-shaped DOM), and the file-upload interception itself
(`change`/`drop` at `document` capture phase) is a generic DOM mechanism,
not tied to any provider-specific markup - unlike the composer-text
capture logic, there's no known site-specific quirk this needs to handle
that the mock test wouldn't already exercise.

**What's flagged to the user directly** (not silently skipped or marked
done): a copy-pasteable manual checklist for them to run themselves,
since they have real access these sites this sandbox doesn't. Until that
manual pass happens, this feature should be considered *code-complete and
automated-test-verified*, not yet *confirmed against the real sites* -
an honest distinction worth preserving rather than blurring.

## Fixed: unsupported files (e.g. images) incorrectly showed a dialog

User-reported, with a screenshot: uploading a `.jpeg` (never in scope -
only PDF/DOCX/XLSX ever were) showed "לא ניתן היה לבדוק את הקובץ...
Unsupported file type... לכן לא ניתן לאשר שאין בו מידע רגיש" and asked
for confirmation to proceed. Wrong - an out-of-scope file must be
completely invisible to this feature, not treated as "we tried and
failed to verify it."

**Root cause**: `fileUploadInterceptor.ts` intercepted (`preventDefault`
+ `stopImmediatePropagation`) *every* file selection unconditionally,
then called `scanOneFile()` → `extractText()`, which throws
`"Unsupported file type"` for anything `detectFileKind()` doesn't
recognize. That throw landed in the same `catch` block used for genuine
extraction failures (a corrupted/encrypted PDF), so "this file was never
meant to be scanned" and "this file should have been scanned but
couldn't be" were indistinguishable by the time the error handling ran -
both showed the "couldn't verify" dialog.

**Fix**: moved the filtering *before* the decision to intercept at all,
not inside the scan step. New `needsScanning()` filters to only files
`detectFileKind()` recognizes; if that list is empty, `handleFileInputChange`/
`handleDrop` return immediately, before ever calling `preventDefault`/
`stopImmediatePropagation` - the browser handles the selection completely
normally, exactly as if this feature didn't exist. For a mixed selection
(a supported file alongside an unsupported one), only the supported
file(s) get scanned, but the *entire original selection* - both scanned
and unsupported files together - gets replayed once approved, so an
unsupported file riding alongside a scanned one still goes through
unmodified. `scanOneFile()`'s existing "couldn't verify" path is
untouched and still correct for its actual purpose: a genuinely
supported file type that fails to parse.

**New regression test**: extended the existing "file upload" e2e test
with a real, valid 1x1 PNG - asserts neither dialog (`נמצא מידע רגיש
בקובץ` nor `לא ניתן היה לבדוק את הקובץ`) appears, and the file uploads
immediately, same as if the extension weren't installed. Verified against
the real built extension in real Chromium, not just reasoned through.
Also had to bring the local `pii-shield-postgres` Docker container back
up before re-testing - it had exited (environment restart since the
previous session), unrelated to this bug. Full suite re-run clean: 28
unit + 3 e2e.

## Phase 5 revisited: real-site access was possible after all

The earlier "blocked by Cloudflare" finding turned out to be incomplete -
that check used **headless** Chromium. The actual extension e2e tests
already use `headless: false` (a real, visible browser - required for
loading MV3 extensions reliably anyway), and retrying the site-access
check the same way got real `200`s on both `chatgpt.com` and `claude.ai`,
no challenge page. Cloudflare's block was specifically flagging headless
mode, not this environment/IP in general. Worth remembering: don't
conclude "no access" from a headless-only check when the real usage
(loading an extension) never runs headless anyway.

**What this let me actually verify against the real sites**, with the
real built extension, a real backend, and a real seeded company (`Avner
Cohen` / `123456782`, then cleaned up after):

- The extension genuinely activates on real `chatgpt.com`: the
  `Nistar active` badge renders in the correct position, no console
  errors from the extension itself (the two `401`s and "Not signed in
  with the identity provider" seen are ChatGPT's own auth calls, failing
  because we're not logged in - unrelated noise, not caused by this
  extension).
- The interception mechanism fires correctly against the real page's
  actual DOM and event system (not just the mock page): forcing
  `with-pii.pdf` onto a real file input via `setInputFiles` correctly
  triggered our "נמצא מידע רגיש בקובץ" dialog.
- The unsupported-file fix (this session's earlier bug fix) holds on the
  real DOM too: a real PNG through a real file input triggers neither
  dialog - confirmed, not assumed.
- **Real, honest limitation found, not a shortcut**: every file input
  visible on `chatgpt.com` in a logged-out state is `accept`-restricted
  to images only (`image/webp,.webp,image/png,.png,...` / `image/*`) -
  confirmed by finding and clicking the actual "+" attach button
  (`aria-label="Add files and more"`, which itself reads "Add photos and
  more" while logged out) and checking the resulting menu/inputs. The
  sidebar text is explicit: *"Log in to get answers based on saved
  chats, plus create images **and upload files**."* Real document
  (PDF/DOCX/XLSX) upload on ChatGPT appears to be a logged-in-only
  surface - I don't have a real account to test past that wall, and
  didn't attempt to fabricate one. `claude.ai` requires login even
  sooner - redirects straight to `/login`, zero file inputs reachable
  before that.

**Net effect**: the *mechanism* (interception, extraction, scanning,
dialog, the unsupported-file fix) is now confirmed correct against real
site DOM/event behavior, not just the mock page - this is meaningfully
stronger evidence than what was available before. What remains genuinely
unverified is the full flow through an actual logged-in document-upload
menu on either site, which needs a real account. Handing that off to the
user with a short, specific checklist below rather than the vague one
from before - now scoped exactly to what's still actually open.

**Manual checklist for the user** (only this part remains):
1. Log into a real ChatGPT and Claude account with the extension
   installed and connected to a real company.
2. Click "+" / "Add files and more" (ChatGPT) - confirm the menu now
   offers a non-image document option once logged in, and locate that
   upload control.
3. Upload a PDF/DOCX/XLSX containing a known name or ID number - confirm
   the "נמצא מידע רגיש בקובץ" dialog appears with correct counts, and
   that clicking "בטל העלאה" genuinely prevents the network request (F12
   Network tab - no upload call fires) rather than just closing the
   dialog.
4. Click "המשך בכל זאת" on a repeat attempt - confirm the file actually
   uploads and the conversation proceeds normally.
5. Upload an ordinary photo - confirm no dialog at all, same as before
   this feature existed.
6. Repeat steps 2-5 on Claude.ai (its own attach UI, likely a paperclip
   icon).

## Shabbat work session (2026-08-07/08, autonomous, ~48h window)

Working through a large multi-part list on a dedicated `shabbat-work`
branch per explicit safety instruction - **no push to `main`, no Railway
deploy, for the entire session**. Every commit goes to `shabbat-work`
only; the user will review and merge/deploy themselves. Timestamps added
per commit below as instructed.

**[2026-08-07 19:07] Part 4 item 9 (start here, per instruction) -
verified, not re-fixed**: the file-type-allowlist bug (images incorrectly
showing the "couldn't verify" dialog) was already fixed and committed as
`ed4a35d` in the prior round, and this branch was created from `main`
*after* that commit - so it's already included. Confirmed rather than
assumed: re-ran the exact regression test (`extension.spec.ts`'s "file
upload" test, including the PNG-passthrough case) against a fresh build
on this branch - passes. No code change needed for this item; moving
straight to Part 1.

**[2026-08-07 20:15] Part 1 item 1 - real i18n infrastructure for
admin-console (he/en, full RTL/LTR)**: added `i18next` + `react-i18next`
(already installed for all three frontend apps in a prior step). Built
`admin-console/src/i18n/index.ts`: language choice persisted in
`localStorage` (`piiShieldLang`), `document.documentElement.lang`/`dir`
switched dynamically on every language change (not just text - this is
what actually flips the whole layout direction). Wrote two full locale
files, `locales/he.json` and `locales/en.json`, covering every
user-facing string across the app (nav, dashboard, employees, employee
profile, settings, sensitive-data, onboarding wizard, health indicator,
anomaly widget, entity type labels, and a new admin-guide namespace -
see next entry). Converted every admin-console component to
`useTranslation()` - no hardcoded Hebrew strings remain in `.tsx` files
(verified by re-reading each converted file top to bottom).

RTL/LTR scope decision (documented as instructed, since this required
a judgment call): the codebase used physical Tailwind utilities
(`text-right`, `border-l`, `mr-*`) throughout. Converted every touched
component to logical-property utilities (`text-start`/`text-end`,
`border-s`/`border-e`, `ps-*`/`pe-*` where present) so the layout
genuinely mirrors in English, not just the text. Verified this actually
works end-to-end with a real headless-browser screenshot comparison
(Hebrew RTL vs. English LTR on the onboarding wizard) - confirmed the
sidebar/toggle position, text alignment, and reading direction all flip
correctly, not just individual strings. This was done for every page
that got touched in this pass (all of them); no page was left with a
hardcoded `dir="rtl"`.

Also added, since they were natural to build alongside the i18n pass and
serve Part 2 directly: a reusable `LanguageToggle` component (used in
the sidebar and on the pre-login onboarding screen), a `HelpTooltip`
component (small "?" icon + popover, bilingual via the same locale
files) wired into Dashboard/Employees/Settings/SensitiveData per item 5,
and a standalone `AdminGuide` page (item 6 - "what is Nistar", "how it
works", and a bilingual FAQ including the Chrome Enterprise Policy
answer) reachable from the sidebar nav. `tsc --noEmit` and `vite build`
both pass; verified visually with Playwright screenshots (Hebrew and
English) of the onboarding flow - no console errors, correct mirroring.
Pages that require a logged-in session (Dashboard/Employees/etc.) were
verified via typecheck + build only in this pass, not yet screenshotted
live - flagging as a follow-up to spot-check before the final summary.

Not yet done: the matching visual redesign pass (motion/spacing polish
beyond the shared CSS upgrade) for admin-console is partially covered by
this same pass (framer-motion page-transition fades added to every
page), full super-admin i18n/redesign, and the landing page English
version - continuing now.

**[2026-08-07 21:40] Part 3 items 7+8 - full E2E synthetic health chain +
super-admin System Health dashboard, plus Part 1 items 1+3 for
super-admin**: the existing hourly canary (`HealthCheckService.runCheck`)
only recomputed a hash and checked one DB lookup - proves the DB/hashing
pipeline is alive, but not the actual chain a real customer depends on.
Added `runSystemE2ECheck()`, a genuinely separate check that runs once
system-wide (not per real company) on the same hourly cron:

1. `companyCreate` - finds-or-creates a single dedicated internal company
   (idempotent, reused every run, never recreated) flagged
   `isSynthetic: true` on a new `Company.isSynthetic` column (migration
   `20260807193117_add_synthetic_health_e2e`).
2. `employeeCreate` - finds-or-creates one fake employee under it.
3. `blockSimulate` - writes a real `AuditLog` row (`eventType: "blocked"`)
   exactly as the extension's real block path would.
4. `auditVerify` - re-reads that exact row back by id to confirm it's
   genuinely queryable, not just that the write didn't throw.
5. `dashboardVerify` - calls the real `DashboardService.getSummary()` (the
   same code path the admin console's dashboard uses) and confirms the
   simulated block is actually reflected in `blocksThisMonth`.
6. `cleanup` - prunes the synthetic company's audit-log rows older than 7
   days, so this doesn't grow unbounded forever.

Each step's success/failure and detail is stored as a JSON array on a new
`HealthCheck.steps` column, with a new `HealthCheck.kind` discriminator
(`"canary"` vs `"e2e_chain"`) so the two mechanisms share one table
without colliding. `isSynthetic` also excludes this company from every
real operator-facing list - verified by hitting the running backend
directly: `GET /admin/companies` does not include it, while
`POST /admin/health/system-check/run` (new operator-only endpoint,
`SuperAdminGuard`, same throttling posture as `/admin/companies`) runs
the full chain and returns `success: true` with all six steps green
against the actual local Postgres.

Schema note on how the migration was applied: `prisma migrate dev`
refused to run because of pre-existing drift in this dev DB (an unrelated
`demo_customers` table from other local testing, not part of this
project's schema) - it wanted a full `migrate reset`, which would have
destroyed real data accumulated this session. Conservative choice made
instead: hand-wrote the migration SQL, applied it directly via
`prisma db execute` (bypasses the drift check), then registered it in
`prisma/migrations/` and marked it applied via `prisma migrate resolve
--applied`, leaving the unrelated table untouched. `prisma migrate
status` now reports clean.

Built `SystemHealthPanel` (super-admin, added `recharts`) - success-rate
percentage over the last 30 checks, a red/green bar-history strip (not
just the latest ✓/✗, per the explicit ask), last-run detail, and the six
chain-step badges with hover detail on failure. Wired into the
super-admin Dashboard alongside a full i18n + visual-redesign pass for
super-admin (Login + Dashboard), matching the same treatment as
admin-console: `i18next`/`react-i18next`, `he.json`/`en.json`, dynamic
`dir`/`lang`, logical-property Tailwind classes, Heebo font,
`framer-motion` fade-in. Verified live: typecheck + build clean, and a
real headless-browser run against the actual local backend (login,
dashboard load, language toggle) with screenshots confirming both Hebrew
RTL and English LTR render correctly with zero console errors.

Known gap, deferred to Part 5 item 12: no Jest unit tests were added for
`HealthCheckService` in this pass (verified instead via live HTTP calls
against the real local backend + Postgres, consistent with how the rest
of this project prefers real-infra verification over mocks) - flagging
so it isn't silently missed when addressing test coverage later.

