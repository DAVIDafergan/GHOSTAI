export interface EntityHashPayload {
  entityHash: string;
  entityType: string;
  confidence: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retryable request error - used to distinguish transient failures (network
 * drop, 5xx) from real client errors (bad request, auth failure) so we only
 * retry-with-backoff the former (spec 6.6: "connection drops mid-sync").
 */
class RequestError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
  }
}

export class BackendClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly maxAttempts = 5,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            ...(init.headers ?? {}),
          },
        });
        if (res.status >= 500) {
          throw new RequestError(`Backend returned ${res.status} for ${path}`, true);
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new RequestError(`Backend request failed: ${res.status} ${path} ${body}`, false);
        }
        return (await res.json()) as T;
      } catch (err) {
        lastErr = err;
        const retryable = err instanceof RequestError ? err.retryable : true; // network-level errors are retryable
        if (!retryable || attempt === this.maxAttempts) throw err;
        const delayMs = Math.min(30000, 500 * 2 ** (attempt - 1));
        await sleep(delayMs);
      }
    }
    throw lastErr;
  }

  getCompanySalt(): Promise<{ entitySalt: string; confidenceThreshold: number }> {
    return this.request('/companies/me');
  }

  createConnector(sourceType: string): Promise<{ id: string }> {
    return this.request('/connectors', { method: 'POST', body: JSON.stringify({ sourceType }) });
  }

  startSync(connectorId: string): Promise<void> {
    return this.request(`/connectors/${connectorId}/sync/start`, { method: 'POST' });
  }

  completeSync(connectorId: string): Promise<void> {
    return this.request(`/connectors/${connectorId}/sync/complete`, { method: 'POST' });
  }

  failSync(connectorId: string): Promise<void> {
    return this.request(`/connectors/${connectorId}/sync/fail`, { method: 'POST' });
  }

  ingestBatch(connectorId: string, entities: EntityHashPayload[]): Promise<{ ingested: number }> {
    return this.request('/entities/batch', {
      method: 'POST',
      body: JSON.stringify({ connectorId, entities }),
    });
  }
}
