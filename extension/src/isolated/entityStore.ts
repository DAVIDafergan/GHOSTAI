import { getConfig } from '../shared/config';
import { EntityIndex } from '../shared/tokenizer';

export interface EntityStoreState {
  entityIndex: EntityIndex;
  companySalt: string | null;
  confidenceThreshold: number;
  enabledEntityTypes: string[];
  failSafe: boolean;
  backendUrl: string | null;
  extensionKey: string | null;
}

interface EntitiesPage {
  entities: { entityHash: string; entityType: string; confidence: number }[];
  nextCursor: string | null;
}

async function fetchAllEntities(backendUrl: string, extensionKey: string): Promise<EntityIndex> {
  const index: EntityIndex = new Map();
  let cursor: string | null = null;
  do {
    const url = new URL(`${backendUrl}/entities`);
    url.searchParams.set('limit', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url.toString(), { headers: { 'x-extension-key': extensionKey } });
    if (!res.ok) throw new Error(`Failed to fetch entities: ${res.status}`);
    const page = (await res.json()) as EntitiesPage;
    for (const e of page.entities) {
      index.set(`${e.entityType}:${e.entityHash}`, { confidence: e.confidence });
    }
    cursor = page.nextCursor;
  } while (cursor);
  return index;
}

const FAIL_SAFE_STATE: EntityStoreState = {
  entityIndex: new Map(),
  companySalt: null,
  confidenceThreshold: 50,
  enabledEntityTypes: [],
  failSafe: true,
  backendUrl: null,
  extensionKey: null,
};

/**
 * spec 6.6: if the backend is unreachable when an employee wants to send a
 * message, default is fail-safe - fall back to regex-only blocking (no
 * company DB comparison) rather than ever sending completely unchecked.
 */
export async function loadEntityStore(): Promise<EntityStoreState> {
  const config = await getConfig();
  if (!config) return FAIL_SAFE_STATE;

  try {
    const meRes = await fetch(`${config.backendUrl}/employees/me`, {
      headers: { 'x-extension-key': config.extensionKey },
    });
    if (!meRes.ok) throw new Error(`employees/me failed: ${meRes.status}`);
    const me = (await meRes.json()) as {
      company: { entitySalt: string; confidenceThreshold: number; enabledEntityTypes: string[] };
    };
    const entityIndex = await fetchAllEntities(config.backendUrl, config.extensionKey);
    return {
      entityIndex,
      companySalt: me.company.entitySalt,
      confidenceThreshold: me.company.confidenceThreshold,
      enabledEntityTypes: me.company.enabledEntityTypes,
      failSafe: false,
      backendUrl: config.backendUrl,
      extensionKey: config.extensionKey,
    };
  } catch {
    return FAIL_SAFE_STATE;
  }
}
