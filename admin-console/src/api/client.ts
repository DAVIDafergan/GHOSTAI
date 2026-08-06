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

/**
 * The backend's error responses are always JSON (`{ statusCode, message,
 * error? }` - Nest's own shape, and `message` can be a single string or an
 * array of validation errors from the ValidationPipe). Extract a clean,
 * human-readable string rather than surfacing the raw JSON body to the
 * user if a caller renders `ApiError.message` directly.
 */
async function extractErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `שגיאה בשרת (קוד ${res.status})`;
  try {
    const parsed = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) return parsed.message.join(', ');
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    // Not JSON - fall through to the generic message below rather than
    // displaying whatever raw text came back.
  }
  return `שגיאה בשרת (קוד ${res.status})`;
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
    throw new ApiError(await extractErrorMessage(res), res.status);
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
  name: string | null;
  email: string;
  status: 'not_installed' | 'active' | 'inactive' | 'disabled';
  createdAt: string;
  lastActiveAt: string | null;
  blockCount: number;
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
  employeeName: string | null;
  eventType: string;
  entityType: string | null;
  platform: string | null;
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

export interface AnomalyReason {
  type: 'high_blocks' | 'repeated_override' | 'unusual_hours';
  detail: string;
}

export interface Anomaly {
  employeeId: string;
  name: string | null;
  email: string;
  blocksThisWeek: number;
  medianOfOthers: number;
  reasons: AnomalyReason[];
}

export interface HealthCheckResult {
  id: string;
  companyId: string;
  ranAt: string;
  success: boolean;
  detail: string | null;
}

export const api = {
  createCompany: (backendUrl: string, adminUsername: string, adminPassword: string, name: string, adminEmail?: string) =>
    request<{ id: string; name: string; apiKey: string; createdAt: string }>(
      { backendUrl, apiKey: '' },
      '/admin/companies',
      {
        method: 'POST',
        headers: { 'x-admin-username': adminUsername, 'x-admin-password': adminPassword },
        body: JSON.stringify({ name, adminEmail }),
      },
    ),

  getCompany: (session: Session) => request<Company>(session, '/companies/me'),

  updateSettings: (session: Session, settings: { confidenceThreshold?: number; enabledEntityTypes?: string[] }) =>
    request<Company>(session, '/companies/me', { method: 'PATCH', body: JSON.stringify(settings) }),

  listEmployees: (session: Session) => request<EmployeeSummary[]>(session, '/employees'),

  getEmployee: (session: Session, id: string) => request<EmployeeSummary>(session, `/employees/${id}`),

  createEmployee: (session: Session, email: string, name?: string) =>
    request<{ id: string; name: string | null; email: string; extensionKey: string; createdAt: string }>(
      session,
      '/employees',
      { method: 'POST', body: JSON.stringify({ email, name }) },
    ),

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

  getAnomalies: (session: Session) =>
    request<{ anomalies: Anomaly[]; windowDays: number }>(session, '/dashboard/anomalies'),

  getLatestHealthCheck: (session: Session) =>
    request<HealthCheckResult | null>(session, '/health-check/latest'),

  runHealthCheck: (session: Session) =>
    request<HealthCheckResult>(session, '/health-check/run', { method: 'POST' }),
};
