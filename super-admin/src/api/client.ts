// Entirely separate auth from the per-company admin-console: this app
// authenticates as the PII Shield operator via ADMIN_BOOTSTRAP_SECRET, not
// any company's apiKey. Own localStorage key so there's no chance of
// cross-contamination even if both apps are somehow open in the same
// browser (different origins in production anyway - separate Railway
// services/domains).
export interface SuperAdminSession {
  backendUrl: string;
  adminSecret: string;
}

const STORAGE_KEY = 'piiShieldSuperAdminSession';

export function loadSession(): SuperAdminSession | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SuperAdminSession;
  } catch {
    return null;
  }
}

export function saveSession(session: SuperAdminSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(session: SuperAdminSession, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${session.backendUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-admin-secret': session.adminSecret,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(body || `Request failed with status ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface CompanySummary {
  id: string;
  name: string;
  adminEmail: string | null;
  status: string;
  createdAt: string;
  employeeCount: number;
  blocksThisMonth: number;
  connectorStatus: string;
  connectorLastSyncAt: string | null;
  healthCheckSuccess: boolean | null;
  healthCheckAt: string | null;
}

export const api = {
  /** Verifies backendUrl+adminSecret are actually valid before treating
   * login as successful, rather than just saving whatever was typed. */
  verifyAndListCompanies: (session: SuperAdminSession) => request<CompanySummary[]>(session, '/admin/companies'),

  createCompany: (session: SuperAdminSession, name: string, adminEmail?: string) =>
    request<{ id: string; name: string; apiKey: string; createdAt: string }>(session, '/admin/companies', {
      method: 'POST',
      body: JSON.stringify({ name, adminEmail: adminEmail || undefined }),
    }),

  disableCompany: (session: SuperAdminSession, id: string) =>
    request<void>(session, `/admin/companies/${id}`, { method: 'DELETE' }),
};
