// Entirely separate auth from the per-company admin-console: this app
// authenticates as the Nistar operator via a single operator account
// (SUPER_ADMIN_USERNAME/SUPER_ADMIN_PASSWORD on the backend), not any
// company's apiKey. Own localStorage key so there's no chance of
// cross-contamination even if both apps are somehow open in the same
// browser (different origins in production anyway - separate Railway
// services/domains).
export interface SuperAdminSession {
  backendUrl: string;
  username: string;
  password: string;
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

/**
 * The backend's error responses are always JSON (`{ statusCode, message,
 * error? }` - Nest's own shape, and `message` can be a single string or an
 * array of validation errors from the ValidationPipe). Extract a clean,
 * human-readable string rather than surfacing the raw JSON body to the
 * user if a caller renders `ApiError.message` directly.
 */
async function extractErrorMessage(res: Response): Promise<string> {
  // This module sits below React (no useTranslation here), so it reads the
  // language i18n already set on <html> rather than duplicating a second
  // language store.
  const genericMessage =
    document.documentElement.lang === 'en' ? `Server error (code ${res.status})` : `שגיאה בשרת (קוד ${res.status})`;
  const text = await res.text().catch(() => '');
  if (!text) return genericMessage;
  try {
    const parsed = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) return parsed.message.join(', ');
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    // Not JSON - fall through to the generic message below rather than
    // displaying whatever raw text came back.
  }
  return genericMessage;
}

async function request<T>(session: SuperAdminSession, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${session.backendUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-admin-username': session.username,
      'x-admin-password': session.password,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
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

export interface SystemHealthCheck {
  id: string;
  companyId: string;
  ranAt: string;
  success: boolean;
  detail: string | null;
  kind: string;
  steps: { key: string; success: boolean; detail?: string }[] | null;
}

export const api = {
  /** Verifies backendUrl+username+password are actually valid before treating
   * login as successful, rather than just saving whatever was typed. */
  verifyAndListCompanies: (session: SuperAdminSession) => request<CompanySummary[]>(session, '/admin/companies'),

  createCompany: (session: SuperAdminSession, name: string, adminEmail?: string) =>
    request<{ id: string; name: string; apiKey: string; createdAt: string }>(session, '/admin/companies', {
      method: 'POST',
      body: JSON.stringify({ name, adminEmail: adminEmail || undefined }),
    }),

  disableCompany: (session: SuperAdminSession, id: string) =>
    request<void>(session, `/admin/companies/${id}`, { method: 'DELETE' }),

  getSystemHealthHistory: (session: SuperAdminSession, limit = 100) =>
    request<SystemHealthCheck[]>(session, `/admin/health/system-history?limit=${limit}`),

  runSystemHealthCheckNow: (session: SuperAdminSession) =>
    request<SystemHealthCheck>(session, '/admin/health/system-check/run', { method: 'POST' }),
};
