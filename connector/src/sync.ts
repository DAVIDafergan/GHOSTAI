import { ConnectorConfig, resolveStateFilePath } from './config';
import { BackendClient, EntityHashPayload } from './backendClient';
import { computeEntityHash } from './hashing';
import { extractFromPostgres } from './sources/postgres.source';
import { extractFromCsv } from './sources/csv.source';
import { LocalStateStore } from './localState';

const BATCH_SIZE = 500;

export interface SyncResult {
  connectorId: string;
  ingested: number;
}

export async function runSync(
  config: ConnectorConfig,
  logger: (msg: string) => void = console.log,
  store: LocalStateStore = new LocalStateStore(resolveStateFilePath(config)),
): Promise<SyncResult> {
  const client = new BackendClient(config.backendUrl, config.apiKey);

  const { entitySalt } = await client.getCompanySalt();

  let connectorId = config.connectorId;
  if (!connectorId) {
    const connector = await client.createConnector(config.source.type);
    connectorId = connector.id;
    logger(
      `Created connector ${connectorId} - add "connectorId": "${connectorId}" to your config to reuse it on future runs.`,
    );
  }

  await client.startSync(connectorId);

  try {
    let batch: EntityHashPayload[] = [];
    let ingested = 0;

    const flushBatch = async () => {
      if (!batch.length) return;
      const result = await client.ingestBatch(connectorId as string, batch);
      ingested += result.ingested;
      logger(`Synced ${ingested} entities so far...`);
      batch = [];
    };

    const extractor =
      config.source.type === 'postgres' ? extractFromPostgres(config.source) : extractFromCsv(config.source);

    // Same value can appear on multiple rows within one run (e.g. a shared
    // phone number); collapse to a single hash+type so it isn't counted or
    // sent redundantly (spec 6.6: "same entity appears multiple times").
    const seen = new Set<string>();

    const maybeQueue = async (value: string, entityType: string) => {
      const entityHash = computeEntityHash(value, entitySalt);
      const dedupeKey = `${entityHash}:${entityType}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      batch.push({ entityHash, entityType, confidence: 100 });
      if (batch.length >= BATCH_SIZE) await flushBatch();
    };

    for await (const rowValues of extractor) {
      for (const { value, entityType } of rowValues) {
        // Recorded locally regardless of exclusion, so an excluded entity
        // that's still at the source keeps a fresh lastSeenAt and doesn't
        // look "gone" in the sensitive-data tab - only its `excluded` flag
        // (an admin decision, never touched here) controls whether it's
        // actually sent to the central backend.
        store.upsertSeen(value, entityType);
        if (store.get(value, entityType)?.excluded) continue;
        await maybeQueue(value, entityType);
      }
    }
    store.flush();

    // Manually-added entities (via the connector's local API, never
    // present in the source itself) are synced the same way, still subject
    // to exclusion.
    for (const manual of store.list({ excluded: false })) {
      if (manual.origin !== 'manual') continue;
      await maybeQueue(manual.value, manual.entityType);
    }
    await flushBatch();

    await client.completeSync(connectorId);
    return { connectorId, ingested };
  } catch (err) {
    await client.failSync(connectorId).catch(() => undefined);
    throw err;
  }
}
