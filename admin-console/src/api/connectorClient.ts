// Talks DIRECTLY to a connector running inside the customer's own network -
// never through the central backend, which by design only ever sees entity
// hashes (see SECURITY.md). The connector URL is a "reach into my own
// local/private network" detail specific to this browser/admin, so it's
// kept in localStorage only, never sent to or stored by the central
// backend.
const CONNECTOR_URL_KEY = 'piiShieldConnectorUrl';

export function loadConnectorUrl(): string | null {
  return localStorage.getItem(CONNECTOR_URL_KEY);
}

export function saveConnectorUrl(url: string): void {
  localStorage.setItem(CONNECTOR_URL_KEY, url.trim().replace(/\/$/, ''));
}

export function clearConnectorUrl(): void {
  localStorage.removeItem(CONNECTOR_URL_KEY);
}

export interface ConnectorEntity {
  value: string;
  entityType: string;
  firstSeenAt: string;
  lastSeenAt: string;
  origin: 'synced' | 'manual';
  excluded: boolean;
}

export interface ConnectorHealth {
  ok: boolean;
  entityCount: number;
  activeCount: number;
}

export class ConnectorApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 5000;

async function connectorRequest<T>(
  connectorUrl: string,
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${connectorUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      throw new ConnectorApiError(`Connector request failed: ${res.status}`, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ConnectorApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ConnectorApiError('Timed out reaching the connector');
    }
    throw new ConnectorApiError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timeout);
  }
}

export interface EntityListParams {
  entityType?: string;
  search?: string;
  excluded?: boolean;
  since?: string;
  offset?: number;
  limit?: number;
}

export const connectorApi = {
  health: (url: string, apiKey: string) => connectorRequest<ConnectorHealth>(url, apiKey, '/health'),

  listEntities: (url: string, apiKey: string, params: EntityListParams = {}) => {
    const qs = new URLSearchParams();
    if (params.entityType) qs.set('entityType', params.entityType);
    if (params.search) qs.set('search', params.search);
    if (params.excluded !== undefined) qs.set('excluded', String(params.excluded));
    if (params.since) qs.set('since', params.since);
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return connectorRequest<{ entities: ConnectorEntity[]; total: number; offset: number; limit: number }>(
      url,
      apiKey,
      `/entities${query ? `?${query}` : ''}`,
    );
  },

  addManual: (url: string, apiKey: string, value: string, entityType: string) =>
    connectorRequest<ConnectorEntity>(url, apiKey, '/entities/manual', {
      method: 'POST',
      body: JSON.stringify({ value, entityType }),
    }),

  removeManual: (url: string, apiKey: string, value: string, entityType: string) =>
    connectorRequest<{ removed: boolean }>(url, apiKey, '/entities/manual', {
      method: 'DELETE',
      body: JSON.stringify({ value, entityType }),
    }),

  exclude: (url: string, apiKey: string, value: string, entityType: string) =>
    connectorRequest<ConnectorEntity>(url, apiKey, '/entities/exclude', {
      method: 'POST',
      body: JSON.stringify({ value, entityType }),
    }),

  include: (url: string, apiKey: string, value: string, entityType: string) =>
    connectorRequest<ConnectorEntity>(url, apiKey, '/entities/include', {
      method: 'POST',
      body: JSON.stringify({ value, entityType }),
    }),
};
