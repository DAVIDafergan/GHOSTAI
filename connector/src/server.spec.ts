import type { Server } from 'http';
import { AddressInfo } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startServer } from './server';
import { LocalStateStore } from './localState';
import { ConnectorConfig } from './config';

const API_KEY = 'test-connector-api-key';

async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('connector local HTTP API', () => {
  let dir: string;
  let store: LocalStateStore;
  let server: Server;
  let baseUrl: string;
  const config = {
    backendUrl: 'http://unused',
    apiKey: API_KEY,
    source: { type: 'csv', filePath: 'unused.csv', fieldMappings: [] },
  } as unknown as ConnectorConfig;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pii-shield-server-'));
    store = new LocalStateStore(join(dir, 'state.json'));
    server = startServer(config, store, 0); // port 0 = pick a free ephemeral port
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects requests without the correct x-api-key', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(401);

    const wrongKey = await fetch(`${baseUrl}/health`, { headers: { 'x-api-key': 'wrong' } });
    expect(wrongKey.status).toBe(401);
  });

  it('reports health with entity counts', async () => {
    store.upsertSeen('Avner Cohen', 'name');
    store.flush();
    const res = await fetch(`${baseUrl}/health`, { headers: { 'x-api-key': API_KEY } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, entityCount: 1, activeCount: 1 });
  });

  it('lists, filters, and searches entities', async () => {
    store.upsertSeen('Avner Cohen', 'name');
    store.upsertSeen('123456782', 'id_number');
    store.flush();

    const all = await json(await fetch(`${baseUrl}/entities`, { headers: { 'x-api-key': API_KEY } }));
    expect(all.total).toBe(2);

    const byType = await json(
      await fetch(`${baseUrl}/entities?entityType=name`, { headers: { 'x-api-key': API_KEY } }),
    );
    expect(byType.total).toBe(1);
    expect(byType.entities[0].value).toBe('Avner Cohen');

    const bySearch = await json(await fetch(`${baseUrl}/entities?search=avner`, { headers: { 'x-api-key': API_KEY } }));
    expect(bySearch.total).toBe(1);
  });

  it('adds and removes a manual entity via the API, but refuses to remove a synced one', async () => {
    const addRes = await fetch(`${baseUrl}/entities/manual`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'Manual Person', entityType: 'name' }),
    });
    expect(addRes.status).toBe(201);

    store.upsertSeen('Synced Person', 'name');
    store.flush();

    const removeSynced = await fetch(`${baseUrl}/entities/manual`, {
      method: 'DELETE',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'Synced Person', entityType: 'name' }),
    });
    expect(removeSynced.status).toBe(404);

    const removeManual = await fetch(`${baseUrl}/entities/manual`, {
      method: 'DELETE',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'Manual Person', entityType: 'name' }),
    });
    expect(removeManual.status).toBe(200);
    expect(store.list()).toHaveLength(1);
  });

  it('excludes and re-includes an entity via the API', async () => {
    store.upsertSeen('Avner Cohen', 'name');
    store.flush();

    const excludeRes = await fetch(`${baseUrl}/entities/exclude`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'Avner Cohen', entityType: 'name' }),
    });
    expect((await json(excludeRes)).excluded).toBe(true);
    expect(store.activeEntities()).toHaveLength(0);

    const includeRes = await fetch(`${baseUrl}/entities/include`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'Avner Cohen', entityType: 'name' }),
    });
    expect((await json(includeRes)).excluded).toBe(false);
    expect(store.activeEntities()).toHaveLength(1);
  });
});
