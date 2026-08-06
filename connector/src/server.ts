import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import type { Server } from 'http';
import { ConnectorConfig } from './config';
import { LocalStateStore } from './localState';

/**
 * Local-only HTTP API the admin console's "sensitive data" tab talks to
 * directly - never through the central backend, which by design only ever
 * sees hashes. This is what lets an admin see/search real values and
 * add/exclude entities, entirely within the customer's own network.
 *
 * Auth: the same company apiKey already used to talk to the central
 * backend and already required to log into the admin console at all -
 * reusing it avoids provisioning a second secret for the same trust
 * boundary (whoever has the apiKey already has full company-admin
 * control centrally anyway).
 *
 * CORS is origin:true because auth here is a header (x-api-key), not a
 * cookie, so reflecting the request origin carries no CSRF risk - same
 * reasoning as the central backend's own CORS setup.
 */
export function createServer(config: ConnectorConfig, store: LocalStateStore) {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json());

  app.use((req: Request, res: Response, next: NextFunction) => {
    const provided = req.headers['x-api-key'];
    if (typeof provided !== 'string' || provided !== config.apiKey) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });

  app.get('/health', (_req, res) => {
    const all = store.list();
    res.json({
      ok: true,
      entityCount: all.length,
      activeCount: all.filter((e) => !e.excluded).length,
    });
  });

  app.get('/entities', (req, res) => {
    const { entityType, search, excluded, since, offset, limit } = req.query;
    const filtered = store.list({
      entityType: typeof entityType === 'string' ? entityType : undefined,
      search: typeof search === 'string' ? search : undefined,
      excluded: excluded === 'true' ? true : excluded === 'false' ? false : undefined,
      since: typeof since === 'string' ? since : undefined,
    });
    const offsetNum = Math.max(0, parseInt(String(offset ?? '0'), 10) || 0);
    const limitNum = Math.min(1000, Math.max(1, parseInt(String(limit ?? '200'), 10) || 200));
    const page = filtered
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(offsetNum, offsetNum + limitNum);
    res.json({ entities: page, total: filtered.length, offset: offsetNum, limit: limitNum });
  });

  app.post('/entities/manual', (req, res) => {
    const { value, entityType } = req.body ?? {};
    if (typeof value !== 'string' || !value.trim() || typeof entityType !== 'string') {
      res.status(400).json({ error: 'value and entityType are required' });
      return;
    }
    res.status(201).json(store.addManual(value, entityType));
  });

  app.delete('/entities/manual', (req, res) => {
    const { value, entityType } = req.body ?? {};
    if (typeof value !== 'string' || typeof entityType !== 'string') {
      res.status(400).json({ error: 'value and entityType are required' });
      return;
    }
    const removed = store.removeManual(value, entityType);
    if (!removed) {
      res.status(404).json({ error: 'Not a manually-added entity, or not found' });
      return;
    }
    res.json({ removed: true });
  });

  app.post('/entities/exclude', (req, res) => {
    const { value, entityType } = req.body ?? {};
    if (typeof value !== 'string' || typeof entityType !== 'string') {
      res.status(400).json({ error: 'value and entityType are required' });
      return;
    }
    res.json(store.setExcluded(value, entityType, true));
  });

  app.post('/entities/include', (req, res) => {
    const { value, entityType } = req.body ?? {};
    if (typeof value !== 'string' || typeof entityType !== 'string') {
      res.status(400).json({ error: 'value and entityType are required' });
      return;
    }
    res.json(store.setExcluded(value, entityType, false));
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[connector API] unhandled error:', err);
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}

export function startServer(config: ConnectorConfig, store: LocalStateStore, port: number): Server {
  const app = createServer(config, store);
  return app.listen(port, () => {
    console.log(`Connector API listening on port ${port}`);
  });
}
