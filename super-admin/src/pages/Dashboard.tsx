import { useEffect, useState } from 'react';
import { api, ApiError, CompanySummary } from '../api/client';
import { useSession } from '../context/SessionContext';
import { COLORS } from '../colors';

const CONNECTOR_STATUS_LABEL: Record<string, string> = {
  none: 'אין connector',
  pending: 'ממתין לסנכרון ראשוני',
  connected: 'מחובר',
  syncing: 'מסנכרן',
  error: 'שגיאה',
  sync_incomplete: 'סנכרון לא הושלם',
};

const CONNECTOR_STATUS_COLOR: Record<string, string> = {
  none: COLORS.neutral,
  pending: COLORS.warning,
  connected: COLORS.ok,
  syncing: COLORS.warning,
  error: COLORS.critical,
  sync_incomplete: COLORS.critical,
};

export function Dashboard() {
  const { session, logout } = useSession();
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [connectorFilter, setConnectorFilter] = useState('');
  const [healthFilter, setHealthFilter] = useState('');

  async function refresh() {
    if (!session) return;
    try {
      setCompanies(await api.verifyAndListCompanies(session));
      setError(null);
    } catch {
      setError('לא ניתן היה לטעון את רשימת החברות.');
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setCreateError(null);
    setCreating(true);
    try {
      const result = await api.createCompany(session, newName, newEmail || undefined);
      setCreatedApiKey(result.apiKey);
      setNewName('');
      setNewEmail('');
      await refresh();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'שגיאה ביצירת החברה');
    } finally {
      setCreating(false);
    }
  }

  async function handleDisable(id: string) {
    if (!session) return;
    if (!confirm('להשבית את החברה? הנתונים יישמרו לפי מדיניות השמירה (30 יום) לפני מחיקה סופית.')) return;
    await api.disableCompany(session, id);
    await refresh();
  }

  if (error) {
    return (
      <div className="card max-w-lg">
        <p className="text-red-600">{error}</p>
        <button className="btn-secondary mt-3" onClick={refresh}>
          נסה שוב
        </button>
      </div>
    );
  }

  if (!companies) return <p className="text-gray-500">טוען...</p>;

  const activeCompanies = companies.filter((c) => c.status === 'active').length;
  const totalBlocksThisMonth = companies.reduce((sum, c) => sum + c.blocksThisMonth, 0);

  // Client-side filtering - the whole company list is already in memory
  // (an operator's customer base, not a dataset that needs server-side
  // pagination), so no backend changes needed for this.
  const filteredCompanies = companies.filter((c) => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter && c.status !== statusFilter) return false;
    if (connectorFilter && c.connectorStatus !== connectorFilter) return false;
    if (healthFilter === 'ok' && c.healthCheckSuccess !== true) return false;
    if (healthFilter === 'failed' && c.healthCheckSuccess !== false) return false;
    if (healthFilter === 'never' && c.healthCheckSuccess !== null) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-indigo-700">PII Shield - Super Admin</h1>
        <button onClick={logout} className="btn-secondary text-sm">
          התנתקות
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-gray-500">חברות רשומות</p>
          <p className="text-2xl font-bold">
            {activeCompanies} / {companies.length}
          </p>
          <p className="text-xs text-gray-400">פעילות מתוך הכל</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">חסימות החודש - כלל המערכת</p>
          <p className="text-2xl font-bold">{totalBlocksThisMonth}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">עובדים רשומים - כלל המערכת</p>
          <p className="text-2xl font-bold">{companies.reduce((sum, c) => sum + c.employeeCount, 0)}</p>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">יצירת חברה חדשה</h2>
        <form onSubmit={handleCreate} className="flex items-end gap-2">
          <input
            className="input"
            placeholder="שם החברה"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
          <input
            type="email"
            className="input"
            placeholder="מייל מנהל (אופציונלי)"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <button type="submit" className="btn-primary shrink-0" disabled={creating}>
            {creating ? 'יוצר...' : 'צור חברה'}
          </button>
        </form>
        {createError && <p className="mt-2 text-sm text-red-600">{createError}</p>}
        {createdApiKey && (
          <div className="mt-3 rounded-lg bg-gray-100 p-3 text-xs">
            <p className="mb-1 text-gray-500">
              apiKey של החברה החדשה (מוצג פעם אחת בלבד - העבירו אותו למנהל החברה כדי שיוכל להשלים את
              ה-onboarding):
            </p>
            <code className="break-all text-green-700">{createdApiKey}</code>
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-700">
            כל החברות ({filteredCompanies.length} מתוך {companies.length})
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            <input
              className="input"
              placeholder="חיפוש לפי שם חברה..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">כל הסטטוסים</option>
              <option value="active">פעילה</option>
              <option value="pending_deletion">בתהליך מחיקה</option>
            </select>
            <select className="input" value={connectorFilter} onChange={(e) => setConnectorFilter(e.target.value)}>
              <option value="">כל ה-connectors</option>
              {Object.entries(CONNECTOR_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select className="input" value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)}>
              <option value="">כל ה-health checks</option>
              <option value="ok">🟢 תקין</option>
              <option value="failed">🔴 נכשל</option>
              <option value="never">טרם נבדק</option>
            </select>
          </div>
        </div>
        {companies.length === 0 ? (
          <p className="text-sm text-gray-400">אין עדיין חברות רשומות במערכת.</p>
        ) : filteredCompanies.length === 0 ? (
          <p className="text-sm text-gray-400">אין חברות התואמות את הסינון.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-right text-gray-500">
                <th className="pb-2">שם</th>
                <th className="pb-2">הצטרפה</th>
                <th className="pb-2">עובדים</th>
                <th className="pb-2">חסימות החודש</th>
                <th className="pb-2">Connector</th>
                <th className="pb-2">Health check</th>
                <th className="pb-2">סטטוס</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-2">
                    <div>{c.name}</div>
                    {c.adminEmail && <div className="text-xs text-gray-400">{c.adminEmail}</div>}
                  </td>
                  <td className="py-2 text-gray-500">{new Date(c.createdAt).toLocaleDateString('he-IL')}</td>
                  <td className="py-2">{c.employeeCount}</td>
                  <td className="py-2">{c.blocksThisMonth}</td>
                  <td className="py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${CONNECTOR_STATUS_COLOR[c.connectorStatus]}`}>
                      {CONNECTOR_STATUS_LABEL[c.connectorStatus] ?? c.connectorStatus}
                    </span>
                  </td>
                  <td className="py-2">
                    {c.healthCheckSuccess === null ? (
                      <span className={`rounded px-2 py-0.5 text-xs ${COLORS.neutral}`}>טרם נבדק</span>
                    ) : (
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${c.healthCheckSuccess ? COLORS.ok : COLORS.critical}`}
                      >
                        {c.healthCheckSuccess ? '🟢 תקין' : '🔴 נכשל'}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        c.status === 'active' ? COLORS.ok : COLORS.critical
                      }`}
                    >
                      {c.status === 'active' ? 'פעילה' : 'בתהליך מחיקה'}
                    </span>
                  </td>
                  <td className="py-2 text-left">
                    {c.status === 'active' && (
                      <button className="text-xs text-red-600 hover:underline" onClick={() => handleDisable(c.id)}>
                        השבת
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
