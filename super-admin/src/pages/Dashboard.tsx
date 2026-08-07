import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { LogOut } from 'lucide-react';
import { api, ApiError, CompanySummary } from '../api/client';
import { useSession } from '../context/SessionContext';
import { COLORS } from '../colors';
import { LanguageToggle } from '../components/LanguageToggle';
import { SystemHealthPanel } from '../components/SystemHealthPanel';

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
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'he' ? 'he-IL' : 'en-US';
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
      setError(t('dashboard.loadError'));
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
      setCreateError(err instanceof ApiError ? err.message : t('dashboard.createError'));
    } finally {
      setCreating(false);
    }
  }

  async function handleDisable(id: string) {
    if (!session) return;
    if (!confirm(t('dashboard.confirmDisable'))) return;
    await api.disableCompany(session, id);
    await refresh();
  }

  const CONNECTOR_STATUS_LABEL: Record<string, string> = {
    none: t('dashboard.connectorStatus.none'),
    pending: t('dashboard.connectorStatus.pending'),
    connected: t('dashboard.connectorStatus.connected'),
    syncing: t('dashboard.connectorStatus.syncing'),
    error: t('dashboard.connectorStatus.error'),
    sync_incomplete: t('dashboard.connectorStatus.sync_incomplete'),
  };

  if (error) {
    return (
      <div className="mx-auto max-w-6xl p-8">
        <div className="card max-w-lg">
          <p className="text-red-600">{error}</p>
          <button className="btn-secondary mt-3" onClick={refresh}>
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!companies) return <p className="p-8 text-gray-500">{t('common.loading')}</p>;

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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mx-auto max-w-6xl space-y-6 p-8"
    >
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-indigo-700">{t('common.appName')}</h1>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <button onClick={logout} className="btn-secondary flex items-center gap-1.5 text-sm">
            <LogOut className="h-3.5 w-3.5" />
            {t('common.logout')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-gray-500">{t('dashboard.registeredCompanies')}</p>
          <p className="text-2xl font-bold">
            {activeCompanies} / {companies.length}
          </p>
          <p className="text-xs text-gray-400">{t('dashboard.activeOfTotal')}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">{t('dashboard.blocksThisMonthSystemWide')}</p>
          <p className="text-2xl font-bold">{totalBlocksThisMonth}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">{t('dashboard.employeesSystemWide')}</p>
          <p className="text-2xl font-bold">{companies.reduce((sum, c) => sum + c.employeeCount, 0)}</p>
        </div>
      </div>

      <SystemHealthPanel />

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('dashboard.createCompanyTitle')}</h2>
        <form onSubmit={handleCreate} className="flex items-end gap-2">
          <input
            className="input"
            placeholder={t('dashboard.companyNamePlaceholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
          <input
            type="email"
            className="input"
            placeholder={t('dashboard.adminEmailPlaceholder')}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <button type="submit" className="btn-primary shrink-0" disabled={creating}>
            {creating ? t('dashboard.creating') : t('dashboard.create')}
          </button>
        </form>
        {createError && <p className="mt-2 text-sm text-red-600">{createError}</p>}
        {createdApiKey && (
          <div className="mt-3 rounded-lg bg-gray-100 p-3 text-xs">
            <p className="mb-1 text-gray-500">{t('dashboard.apiKeyDisplayNote')}</p>
            <code className="break-all text-green-700">{createdApiKey}</code>
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-700">
            {t('dashboard.allCompaniesTitle', { shown: filteredCompanies.length, total: companies.length })}
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            <input
              className="input"
              placeholder={t('dashboard.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t('dashboard.allStatuses')}</option>
              <option value="active">{t('dashboard.statusActive')}</option>
              <option value="pending_deletion">{t('dashboard.statusPendingDeletion')}</option>
            </select>
            <select className="input" value={connectorFilter} onChange={(e) => setConnectorFilter(e.target.value)}>
              <option value="">{t('dashboard.allConnectors')}</option>
              {Object.entries(CONNECTOR_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select className="input" value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)}>
              <option value="">{t('dashboard.allHealthChecks')}</option>
              <option value="ok">{t('dashboard.healthOk')}</option>
              <option value="failed">{t('dashboard.healthFailed')}</option>
              <option value="never">{t('dashboard.healthNever')}</option>
            </select>
          </div>
        </div>
        {companies.length === 0 ? (
          <p className="text-sm text-gray-400">{t('dashboard.noCompaniesYet')}</p>
        ) : filteredCompanies.length === 0 ? (
          <p className="text-sm text-gray-400">{t('dashboard.noCompaniesMatch')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-start text-gray-500">
                <th className="pb-2">{t('dashboard.table.name')}</th>
                <th className="pb-2">{t('dashboard.table.joined')}</th>
                <th className="pb-2">{t('dashboard.table.employees')}</th>
                <th className="pb-2">{t('dashboard.table.blocksThisMonth')}</th>
                <th className="pb-2">{t('dashboard.table.connector')}</th>
                <th className="pb-2">{t('dashboard.table.healthCheck')}</th>
                <th className="pb-2">{t('dashboard.table.status')}</th>
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
                  <td className="py-2 text-gray-500">{new Date(c.createdAt).toLocaleDateString(locale)}</td>
                  <td className="py-2">{c.employeeCount}</td>
                  <td className="py-2">{c.blocksThisMonth}</td>
                  <td className="py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${CONNECTOR_STATUS_COLOR[c.connectorStatus]}`}>
                      {CONNECTOR_STATUS_LABEL[c.connectorStatus] ?? c.connectorStatus}
                    </span>
                  </td>
                  <td className="py-2">
                    {c.healthCheckSuccess === null ? (
                      <span className={`rounded px-2 py-0.5 text-xs ${COLORS.neutral}`}>{t('dashboard.healthNever')}</span>
                    ) : (
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${c.healthCheckSuccess ? COLORS.ok : COLORS.critical}`}
                      >
                        {c.healthCheckSuccess ? t('dashboard.healthOk') : t('dashboard.healthFailed')}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        c.status === 'active' ? COLORS.ok : COLORS.critical
                      }`}
                    >
                      {c.status === 'active' ? t('dashboard.statusActive') : t('dashboard.statusPendingDeletion')}
                    </span>
                  </td>
                  <td className="py-2 text-end">
                    {c.status === 'active' && (
                      <button className="text-xs text-red-600 hover:underline" onClick={() => handleDisable(c.id)}>
                        {t('dashboard.disable')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </motion.div>
  );
}
