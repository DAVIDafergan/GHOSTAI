// Talks DIRECTLY to a connector running inside the customer's own network -
// never through the central backend, which by design only ever sees entity
// hashes (see SECURITY.md). The connector's URL itself isn't sensitive
// (network topology, not PII), so it's stored centrally per-company
// (Company.connectorAdminUrl, via PATCH /companies/me) rather than in this
// browser's localStorage - that's what lets it survive a different device,
// a different browser, or a cleared cache instead of asking again every
// time. See BUILD_LOG.md.
export function normalizeConnectorUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
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
