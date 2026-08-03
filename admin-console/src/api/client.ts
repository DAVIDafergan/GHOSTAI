export interface Session {
  backendUrl: string;
  apiKey: string;
}

const STORAGE_KEY = 'piiShieldAdminSession';

export function loadSession(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
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

async function request<T>(
  session: Session,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${session.backendUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-api-key': session.apiKey,
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

export interface Company {
  id: string;
  name: string;
  entitySalt?: string;
  confidenceThreshold: number;
  enabledEntityTypes: string[];
}

export interface EmployeeSummary {
  id: string;
  email: string;
  status: 'not_installed' | 'active' | 'inactive' | 'disabled';
  createdAt: string;
  lastActiveAt: string | null;
}

export interface ConnectorSummary {
  id: string;
  sourceType: string;
  status: string;
  lastSyncAt: string | null;
}

export interface AuditLogEntry {
  id: string;
  employeeEmail: string;
  eventType: string;
  entityType: string | null;
  createdAt: string;
}

export interface DashboardSummary {
  blocksThisMonth: number;
  totalEmployees: number;
  activeEmployees: number;
  entitiesCount: number;
  connectors: ConnectorSummary[];
  blocksByDay: { date: string; count: number }[];
}

export const api = {
  createCompany: (backendUrl: string, adminSecret: string, name: string, adminEmail?: string) =>
    request<{ id: string; name: string; apiKey: string; createdAt: string }>(
      { backendUrl, apiKey: '' },
      '/admin/companies',
      {
        method: 'POST',
        headers: { 'x-admin-secret': adminSecret },
        body: JSON.stringify({ name, adminEmail }),
      },
    ),

  getCompany: (session: Session) => request<Company>(session, '/companies/me'),

  updateSettings: (session: Session, settings: { confidenceThreshold?: number; enabledEntityTypes?: string[] }) =>
    request<Company>(session, '/companies/me', { method: 'PATCH', body: JSON.stringify(settings) }),

  listEmployees: (session: Session) => request<EmployeeSummary[]>(session, '/employees'),

  createEmployee: (session: Session, email: string) =>
    request<{ id: string; email: string; extensionKey: string; createdAt: string }>(session, '/employees', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  disableEmployee: (session: Session, id: string) =>
    request<void>(session, `/employees/${id}`, { method: 'DELETE' }),

  listConnectors: (session: Session) => request<ConnectorSummary[]>(session, '/connectors'),

  createConnector: (session: Session, sourceType: string) =>
    request<ConnectorSummary>(session, '/connectors', { method: 'POST', body: JSON.stringify({ sourceType }) }),

  getDashboardSummary: (session: Session) => request<DashboardSummary>(session, '/dashboard/summary'),

  listAuditLogs: (session: Session, params: { employeeId?: string; entityType?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.employeeId) query.set('employeeId', params.employeeId);
    if (params.entityType) query.set('entityType', params.entityType);
    const qs = query.toString();
    return request<{ logs: AuditLogEntry[]; nextCursor: string | null }>(
      session,
      `/audit-logs${qs ? `?${qs}` : ''}`,
    );
  },
};
