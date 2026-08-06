/**
 * Standalone integration test (run via `npm run test:integration`, not Jest).
 *
 * Spawning a real backend child process and hitting a real Postgres source
 * hung indefinitely inside Jest's worker sandbox (reproduced repeatedly;
 * the exact same logic run as a plain ts-node script completed in ~3s), so
 * this is a plain script with manual assertions instead of fighting that.
 *
 * Requires: pii-shield-postgres container running, and the demo source db
 * `customer_crm_demo` seeded with a `customers` table (see BUILD_LOG.md /
 * README for the seed data used: 50 rows, including one pair that only
 * differs by case/whitespace, to also exercise dedupe).
 */
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { ChildProcess, spawn } from 'child_process';
import { runSync } from '../src/sync';
import { ConnectorConfig } from '../src/config';
import { LocalStateStore } from '../src/localState';

const BACKEND_DIR = resolve(__dirname, '../../backend');
loadDotenv({ path: resolve(BACKEND_DIR, '.env') });

const PORT = 3098;
const BASE_URL = `http://localhost:${PORT}`;
const ADMIN_SECRET = process.env.ADMIN_BOOTSTRAP_SECRET as string;
const EXPECTED_UNIQUE_HASHES = 49 * 4; // 48 unique rows + 1 deduped pair, x 4 mapped columns

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Backend did not become ready at ${url} within ${timeoutMs}ms`);
}

async function main() {
  if (!ADMIN_SECRET) {
    throw new Error(`ADMIN_BOOTSTRAP_SECRET not found - is ${BACKEND_DIR}/.env present?`);
  }

  log('spawning backend...');
  // Spawning `npx ts-node ...` orphans the actual long-running process once
  // npx's own wrapper exits, so killing the returned child later does
  // nothing - spawn node directly with `-r ts-node/register` instead.
  const backendProcess: ChildProcess = spawn(
    process.execPath,
    ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', 'src/main.ts'],
    { cwd: BACKEND_DIR, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' },
  );
  backendProcess.stdout?.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  backendProcess.stderr?.on('data', (d) => process.stderr.write(`[backend] ${d}`));

  let companyId: string | undefined;
  const stateDir = mkdtempSync(resolve(tmpdir(), 'pii-shield-connector-state-'));

  try {
    await waitForServer(`${BASE_URL}/`, 90000);
    log('backend ready');

    const companyRes = await fetch(`${BASE_URL}/admin/companies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
      body: JSON.stringify({ name: 'Connector Integration Test Co' }),
    });
    assert(companyRes.status === 201, `company creation should return 201, got ${companyRes.status}`);
    const company = (await companyRes.json()) as { id: string; apiKey: string };
    companyId = company.id;
    log(`company created: ${company.id}`);

    const config: ConnectorConfig = {
      backendUrl: BASE_URL,
      apiKey: company.apiKey,
      stateFilePath: resolve(stateDir, 'connector-state.json'),
      source: {
        type: 'postgres',
        connectionString: 'postgresql://pii:pii_dev_password@localhost:5433/customer_crm_demo',
        table: 'customers',
        fieldMappings: [
          { column: 'full_name', entityType: 'name' },
          { column: 'id_number', entityType: 'id_number' },
          { column: 'email', entityType: 'email' },
          { column: 'phone', entityType: 'phone' },
        ],
      },
    };

    const result = await runSync(config, (m) => log(`[runSync] ${m}`));
    log(`runSync result: ${JSON.stringify(result)}`);
    assert(
      result.ingested === EXPECTED_UNIQUE_HASHES,
      `expected ${EXPECTED_UNIQUE_HASHES} ingested, got ${result.ingested}`,
    );

    const employeeRes = await fetch(`${BASE_URL}/employees`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': company.apiKey },
      body: JSON.stringify({ email: 'verifier@connector-integration-test.test' }),
    });
    assert(employeeRes.status === 201, `employee creation should return 201, got ${employeeRes.status}`);
    const employee = (await employeeRes.json()) as { extensionKey: string };

    let cursor: string | null = null;
    let total = 0;
    do {
      const url = new URL(`${BASE_URL}/entities`);
      url.searchParams.set('limit', '50');
      if (cursor) url.searchParams.set('cursor', cursor);
      const listRes = await fetch(url, { headers: { 'x-extension-key': employee.extensionKey } });
      assert(listRes.status === 200, `entities list should return 200, got ${listRes.status}`);
      const page = (await listRes.json()) as { entities: unknown[]; nextCursor: string | null };
      total += page.entities.length;
      cursor = page.nextCursor;
    } while (cursor);

    assert(total === EXPECTED_UNIQUE_HASHES, `expected ${EXPECTED_UNIQUE_HASHES} entities via pagination, got ${total}`);

    // A manually-added entity (never present in the source) should sync
    // like any other, and an excluded one should be pruned by the
    // existing sync/complete logic once it's no longer resent - real
    // end-to-end proof of the local-state exclude/manual behavior, not
    // just the unit-level LocalStateStore tests.
    config.connectorId = result.connectorId;
    const store = new LocalStateStore(config.stateFilePath as string);
    store.addManual('Manual Test Person', 'name');

    async function countEntities(): Promise<number> {
      let c = 0;
      let cur: string | null = null;
      do {
        const url = new URL(`${BASE_URL}/entities`);
        url.searchParams.set('limit', '50');
        if (cur) url.searchParams.set('cursor', cur);
        const res = await fetch(url, { headers: { 'x-extension-key': employee.extensionKey } });
        const page = (await res.json()) as { entities: unknown[]; nextCursor: string | null };
        c += page.entities.length;
        cur = page.nextCursor;
      } while (cur);
      return c;
    }

    await runSync(config, (m) => log(`[runSync manual] ${m}`), store);
    const withManual = await countEntities();
    assert(
      withManual === EXPECTED_UNIQUE_HASHES + 1,
      `expected ${EXPECTED_UNIQUE_HASHES + 1} entities after adding a manual one, got ${withManual}`,
    );
    log('manual entity synced OK');

    store.setExcluded('Manual Test Person', 'name', true);
    await runSync(config, (m) => log(`[runSync excluded] ${m}`), store);
    const afterExclude = await countEntities();
    assert(
      afterExclude === EXPECTED_UNIQUE_HASHES,
      `expected excluded manual entity to be pruned back to ${EXPECTED_UNIQUE_HASHES}, got ${afterExclude}`,
    );
    log('excluded entity pruned OK');

    log('ALL ASSERTIONS PASSED');
  } finally {
    if (companyId) {
      await fetch(`${BASE_URL}/admin/companies/${companyId}`, {
        method: 'DELETE',
        headers: { 'x-admin-secret': ADMIN_SECRET },
      }).catch(() => undefined);
    }
    backendProcess.kill();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log(`FAILED: ${err?.stack ?? err}`);
    process.exit(1);
  });
