# PII Shield - Security Model

Short version: **the central backend never sees raw sensitive values.**
Everything it stores is a one-way hash.

## What's stored where

| Component | What it has | What it never has |
|---|---|---|
| Customer's own data source (CRM/DB/CSV) | raw customer data (names, ID numbers, etc.) | - |
| Connector (runs inside the customer's own network) | the raw values momentarily, in memory, while computing hashes; the company's `entitySalt` | never writes raw values to disk or sends them anywhere |
| Central backend | `entityHash` (HMAC-SHA256), `entityType`, a confidence score | the raw value that produced the hash; the `entitySalt` is stored here too (see "Threat model" below for what this does and doesn't protect against) |
| Browser extension (per employee) | the company's `entitySalt`, the fetched hash list, and, only in memory for the current tab, the raw values it locally matched against a hash - to detokenize the AI's response | never sends raw values to the AI provider; never persists any of this to disk |

## How the hashing works

`entityHash = HMAC-SHA256(normalize(value), companySalt)`, where
`normalize()` trims, lowercases, and collapses whitespace (so "Avner Cohen"
and "avner   cohen" produce the same hash). The exact same function is
implemented independently in the backend, connector, and extension - and a
cross-implementation test in each package asserts they produce byte-for-byte
identical output, so they can never silently drift out of sync.

## Threat model: what this protects against, and what it doesn't

**Protects against:** a breach of the central backend's database. An
attacker who steals every row in `SensitiveEntity`/`Company` gets hashes and
a per-company salt, but not the raw values - they'd need to already know a
candidate value to check whether its hash is present (this is the same
trade-off as a salted password hash: fine for values with real entropy,
weaker for a small/guessable universe of values, which is a real
consideration for something like a 9-digit ID number with a known checksum
- see "Known limitations" below).

**Does not protect against:** a breach of the *connector* (which sees raw
values momentarily while reading the customer's own data source) or the
*browser extension* (which holds the salt and, transiently, the raw values
of whatever it just matched, in that tab's memory only). Those run inside
the customer's own network/browser, which is outside PII Shield's own
threat model - protecting the central operator's infrastructure from being
a single point of catastrophic leakage across all customers is the actual
goal, not full end-to-end secrecy from every possible attacker.

## Credentials

- `apiKey` (company) and `extensionKey` (employee) are both high-entropy
  random secrets (32 bytes), shown to the caller exactly once at creation
  and stored server-side only as a SHA-256 hash (fast, deterministic hashing
  is appropriate here specifically *because* these are random secrets, not
  low-entropy passwords - unlike a password hash, there's no need for a slow
  KDF, and a fast hash allows indexed lookup by hash).
- `ADMIN_BOOTSTRAP_SECRET` gates creating new tenant companies; it's known
  only to the PII Shield operator, not individual customers.

## Known limitations (honest, not hidden)

- **Low-entropy value types are weaker against an offline guessing attack
  on a stolen hash+salt.** An Israeli ID number has ~9 digits with a known
  check-digit algorithm, which shrinks the real search space; someone who
  steals a company's `entitySalt` and hash list could brute-force which
  hashes correspond to valid ID numbers (though not *whose* they are,
  without an external list to cross-reference against). Names and case
  numbers, with much larger real-world entropy, are far less exposed this
  way. This is an inherent trade-off of the salted-hash design for
  low-entropy values, not a bug - flagged here rather than left implicit.
- The Connector currently loads an entire source table into memory in one
  query rather than streaming via a cursor - fine at demo scale, a real
  scaling concern for a customer with millions of rows (see BUILD_LOG.md,
  Week 2).
- No automated purge job for soft-deleted companies yet (30-day retention
  is modeled in the schema - `Company.deletedAt`/`status` - but nothing
  currently runs a scheduled hard-delete after that window).
- CORS is currently configured with `origin: true` (reflects any request
  origin). This is safe under the current auth model (explicit
  `x-api-key`/`x-extension-key` headers, no cookies, so there's no ambient
  credential for a malicious site to ride along with) but should be
  revisited to an explicit allowlist before a production deploy, as defense
  in depth.
