import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useSession } from '../context/SessionContext';
import { api, ApiError } from '../api/client';
import { connectorApi, ConnectorApiError, ConnectorEntity, ConnectorHealth, normalizeConnectorUrl } from '../api/connectorClient';
import { ALL_ENTITY_TYPES } from '../entityTypes';
import { COLORS } from '../colors';
import { HelpTooltip } from '../components/HelpTooltip';

type ConnectionState = 'loading' | 'checking' | 'unreachable' | 'connected' | 'unset';

export function SensitiveData() {
  const { session } = useSession();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'he' ? 'he-IL' : 'en-US';
  const [connectorUrl, setConnectorUrl] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [state, setState] = useState<ConnectionState>('loading');
  const [health, setHealth] = useState<ConnectorHealth | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [entities, setEntities] = useState<ConnectorEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [entityType, setEntityType] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'excluded'>('');
  const [since, setSince] = useState('');
  const [loadingEntities, setLoadingEntities] = useState(false);

  const [manualValue, setManualValue] = useState('');
  const [manualType, setManualType] = useState(ALL_ENTITY_TYPES[0]);
  const [manualError, setManualError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [bulkRows, setBulkRows] = useState<
    { value: string; entityType: string; error?: string; done?: boolean }[] | null
  >(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  async function checkConnection(url: string) {
    if (!session || !url) return;
    setState('checking');
    setErrorDetail(null);
    try {
      const h = await connectorApi.health(url, session.apiKey);
      setHealth(h);
      setState('connected');
    } catch (err) {
      setState('unreachable');
      setErrorDetail(err instanceof ConnectorApiError ? err.message : t('common.unknownError'));
    }
  }

  // The connector's URL lives on the company itself (Company.connectorAdminUrl),
  // not this browser's localStorage - so it survives a different device/
  // browser/cache-clear, and only falls back to asking again if the saved
  // URL turns out to be genuinely unreachable (handled below via checkConnection).
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const company = await api.getCompany(session);
        if (cancelled) return;
        const saved = company.connectorAdminUrl ?? '';
        setConnectorUrl(saved);
        setUrlInput(saved);
        setState(saved ? 'checking' : 'unset');
      } catch {
        if (cancelled) return;
        setState('unset');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (connectorUrl) checkConnection(connectorUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectorUrl]);

  async function loadEntities() {
    if (!session || !connectorUrl || state !== 'connected') return;
    setLoadingEntities(true);
    try {
      const res = await connectorApi.listEntities(connectorUrl, session.apiKey, {
        entityType: entityType || undefined,
        search: search || undefined,
        excluded: status === '' ? undefined : status === 'excluded',
        since: since ? new Date(since).toISOString() : undefined,
        limit: 500,
      });
      setEntities(res.entities);
      setTotal(res.total);
    } catch (err) {
      setState('unreachable');
      setErrorDetail(err instanceof ConnectorApiError ? err.message : t('common.unknownError'));
    } finally {
      setLoadingEntities(false);
    }
  }

  useEffect(() => {
    loadEntities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, entityType, search, status, since]);

  async function handleSaveUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setSaveError(null);
    setSaving(true);
    const normalized = normalizeConnectorUrl(urlInput);
    try {
      await api.updateSettings(session, { connectorAdminUrl: normalized });
      setConnectorUrl(normalized);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t('sensitiveData.errorFetch'));
    } finally {
      setSaving(false);
    }
  }

  async function refreshHealth() {
    if (!session || !connectorUrl) return;
    try {
      setHealth(await connectorApi.health(connectorUrl, session.apiKey));
    } catch {
      // a mutation just succeeded, so the connector is clearly reachable -
      // leave the last-known health counts rather than flip to unreachable
      // over what's likely a transient blip.
    }
  }

  async function handleToggleExclude(entity: ConnectorEntity) {
    if (!session) return;
    const action = entity.excluded ? connectorApi.include : connectorApi.exclude;
    await action(connectorUrl, session.apiKey, entity.value, entity.entityType);
    await Promise.all([loadEntities(), refreshHealth()]);
  }

  async function handleRemoveManual(entity: ConnectorEntity) {
    if (!session) return;
    await connectorApi.removeManual(connectorUrl, session.apiKey, entity.value, entity.entityType);
    await Promise.all([loadEntities(), refreshHealth()]);
  }

  async function handleAddManual(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setManualError(null);
    try {
      await connectorApi.addManual(connectorUrl, session.apiKey, manualValue, manualType);
      setManualValue('');
      await Promise.all([loadEntities(), refreshHealth()]);
    } catch (err) {
      setManualError(err instanceof ConnectorApiError ? err.message : t('sensitiveData.errorAdd'));
    }
  }

  function csvEscape(value: unknown): string {
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /** Fetches every page matching the current filters (not just what's on
   * screen) and downloads a CSV - entirely client-side, using data that
   * already came from the connector directly. Never touches the central
   * backend, same as everything else on this page. */
  async function handleExportCsv() {
    if (!session || !connectorUrl) return;
    setExporting(true);
    setExportError(null);
    try {
      const all: ConnectorEntity[] = [];
      const limit = 500;
      const MAX_ROWS = 20000; // sanity cap, not a real product limit
      let offset = 0;
      let totalReported = Infinity;
      while (offset < totalReported && all.length < MAX_ROWS) {
        const res = await connectorApi.listEntities(connectorUrl, session.apiKey, {
          entityType: entityType || undefined,
          search: search || undefined,
          excluded: status === '' ? undefined : status === 'excluded',
          since: since ? new Date(since).toISOString() : undefined,
          offset,
          limit,
        });
        all.push(...res.entities);
        totalReported = res.total;
        offset += limit;
      }

      const header = 'value,entityType,firstSeenAt,lastSeenAt,origin,excluded';
      const rows = all.map((e) =>
        [e.value, e.entityType, e.firstSeenAt, e.lastSeenAt, e.origin, e.excluded].map(csvEscape).join(','),
      );
      const csv = [header, ...rows].join('\n');
      const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pii-shield-entities-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ConnectorApiError ? err.message : t('sensitiveData.errorExport'));
    } finally {
      setExporting(false);
    }
  }

  function handleBulkCsvSelected(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      // Tolerate an optional header row.
      const dataLines = lines[0]?.toLowerCase().startsWith('value') ? lines.slice(1) : lines;
      const rows = dataLines.map((line) => {
        const [value, type] = line.split(',').map((s) => s.trim());
        if (!value || !type || !ALL_ENTITY_TYPES.includes(type)) {
          return { value: value ?? '', entityType: type ?? '', error: t('sensitiveData.invalidRow') };
        }
        return { value, entityType: type };
      });
      setBulkRows(rows);
    };
    reader.readAsText(file);
  }

  async function handleConfirmBulkExclude() {
    if (!session || !bulkRows) return;
    setBulkProcessing(true);
    const updated = [...bulkRows];
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].error) continue;
      try {
        await connectorApi.exclude(connectorUrl, session.apiKey, updated[i].value, updated[i].entityType);
        updated[i] = { ...updated[i], done: true };
      } catch (err) {
        updated[i] = { ...updated[i], error: err instanceof ConnectorApiError ? err.message : t('employees.genericError') };
      }
    }
    setBulkRows(updated);
    setBulkProcessing(false);
    await Promise.all([loadEntities(), refreshHealth()]);
  }

  const titleWithHelp = (
    <h1 className="flex items-center gap-2 text-xl font-bold">
      {t('sensitiveData.title')}
      <HelpTooltip topic="sensitiveData" />
    </h1>
  );

  if (state === 'loading') {
    return (
      <div className="space-y-6">
        {titleWithHelp}
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </div>
    );
  }

  if (state === 'unset') {
    return (
      <div className="space-y-6">
        {titleWithHelp}
        <div className="card max-w-lg">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">{t('sensitiveData.unsetTitle')}</h2>
          <p className="mb-4 text-sm text-gray-600">{t('sensitiveData.unsetBody')}</p>
          <form onSubmit={handleSaveUrl} className="flex gap-2">
            <input
              className="input"
              placeholder="http://localhost:4100"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              required
            />
            <button type="submit" className="btn-primary shrink-0" disabled={saving}>
              {saving ? t('common.saving') : t('sensitiveData.connect')}
            </button>
          </form>
          {saveError && <p className="mt-2 text-sm text-red-600">{saveError}</p>}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        {titleWithHelp}
        <button
          className="text-xs text-gray-500 hover:underline"
          onClick={() => {
            setState('unset');
            setUrlInput(connectorUrl);
          }}
        >
          {t('sensitiveData.changeUrl')}
        </button>
      </div>

      {state === 'checking' && (
        <div className={`card flex items-center gap-2 ${COLORS.neutral}`}>
          <span className={`h-2.5 w-2.5 shrink-0 animate-pulse rounded-full ${COLORS.neutralDot}`} />
          <p className="text-sm">{t('sensitiveData.connecting')}</p>
        </div>
      )}

      {state === 'unreachable' && (
        <div className={`card border-s-4 border-red-500 ${COLORS.critical}`}>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLORS.criticalDot}`} />
            <p className="text-sm font-medium">{t('sensitiveData.unreachableTitle')}</p>
          </div>
          <p className="mt-2 text-xs text-gray-600">
            {t('sensitiveData.address')}: <code dir="ltr">{connectorUrl}</code>
            {errorDetail && (
              <>
                {' - '}
                {errorDetail}
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-gray-500">{t('sensitiveData.unreachableHelp')}</p>
          <button className="btn-secondary mt-3 text-xs" onClick={() => checkConnection(connectorUrl)}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {state === 'connected' && (
        <>
          <div className={`card flex items-center gap-4 border-s-4 border-green-500`}>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLORS.okDot}`} />
            <p className="text-sm">
              {t('sensitiveData.connectedSummary', { active: health?.activeCount, total: health?.entityCount })}
            </p>
          </div>

          <div className="card">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('sensitiveData.addManualTitle')}</h2>
            <form onSubmit={handleAddManual} className="flex items-end gap-2">
              <input
                className="input"
                placeholder={t('sensitiveData.valuePlaceholder')}
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                required
              />
              <select className="input" value={manualType} onChange={(e) => setManualType(e.target.value)}>
                {ALL_ENTITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`entityTypes.${type}`)}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-primary shrink-0">
                {t('sensitiveData.addToTracking')}
              </button>
            </form>
            {manualError && <p className="mt-2 text-sm text-red-600">{manualError}</p>}
          </div>

          <div className="card">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('sensitiveData.bulkRemoveTitle')}</h2>
            <p className="mb-3 text-xs text-gray-500">{t('sensitiveData.bulkRemoveHelp')}</p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && handleBulkCsvSelected(e.target.files[0])}
            />
            {bulkRows && (
              <div className="mt-3 space-y-2">
                <table className="w-full text-sm">
                  <tbody>
                    {bulkRows.map((row, i) => (
                      <tr key={i} className={row.error ? 'text-red-600' : row.done ? 'text-green-700' : ''}>
                        <td className="py-1">
                          {t('sensitiveData.rowLabel', { n: i + 1 })}: {row.value} ({row.entityType})
                        </td>
                        <td className="py-1">{row.error ?? (row.done ? t('sensitiveData.removedDone') : t('sensitiveData.pending'))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn-primary" onClick={handleConfirmBulkExclude} disabled={bulkProcessing}>
                  {bulkProcessing
                    ? t('sensitiveData.processing')
                    : t('sensitiveData.removeCount', { count: bulkRows.filter((r) => !r.error && !r.done).length })}
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">{t('sensitiveData.filterType')}</label>
                  <select className="input" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
                    <option value="">{t('sensitiveData.all')}</option>
                    {ALL_ENTITY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`entityTypes.${type}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">{t('sensitiveData.filterStatus')}</label>
                  <select
                    className="input"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'excluded' | '')}
                  >
                    <option value="">{t('sensitiveData.all')}</option>
                    <option value="active">{t('sensitiveData.statusActive')}</option>
                    <option value="excluded">{t('sensitiveData.statusExcluded')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">{t('sensitiveData.filterSince')}</label>
                  <input type="date" className="input" value={since} onChange={(e) => setSince(e.target.value)} />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-500">{t('sensitiveData.search')}</label>
                  <input
                    className="input"
                    placeholder={t('sensitiveData.searchPlaceholder')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <button className="btn-secondary shrink-0 text-xs" onClick={handleExportCsv} disabled={exporting}>
                {exporting ? t('sensitiveData.exporting') : t('sensitiveData.exportCsv')}
              </button>
            </div>
            {exportError && <p className="mb-3 text-sm text-red-600">{exportError}</p>}

            {loadingEntities ? (
              <p className="text-sm text-gray-500">{t('common.loading')}</p>
            ) : entities.length === 0 ? (
              <p className="text-sm text-gray-400">{t('sensitiveData.noEntities')}</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-gray-500">{t('sensitiveData.showing', { shown: entities.length, total })}</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-start text-gray-500">
                      <th className="pb-2">{t('sensitiveData.table.value')}</th>
                      <th className="pb-2">{t('sensitiveData.table.type')}</th>
                      <th className="pb-2">{t('sensitiveData.table.firstSeen')}</th>
                      <th className="pb-2">{t('sensitiveData.table.lastSeen')}</th>
                      <th className="pb-2">{t('sensitiveData.table.origin')}</th>
                      <th className="pb-2">{t('sensitiveData.table.status')}</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {entities.map((e) => (
                      <tr key={`${e.entityType}:${e.value}`} className="border-b last:border-0">
                        <td className="py-2 font-mono">{e.value}</td>
                        <td className="py-2">{e.entityType ? t(`entityTypes.${e.entityType}`) : e.entityType}</td>
                        <td className="py-2 text-gray-500">{new Date(e.firstSeenAt).toLocaleDateString(locale)}</td>
                        <td className="py-2 text-gray-500">{new Date(e.lastSeenAt).toLocaleDateString(locale)}</td>
                        <td className="py-2 text-gray-500">
                          {e.origin === 'manual' ? t('sensitiveData.originManual') : t('sensitiveData.originSync')}
                        </td>
                        <td className="py-2">
                          <span className={`rounded px-2 py-0.5 text-xs ${e.excluded ? COLORS.warning : COLORS.ok}`}>
                            {e.excluded ? t('sensitiveData.statusExcluded') : t('sensitiveData.statusActive')}
                          </span>
                        </td>
                        <td className="py-2 text-end">
                          <div className="flex justify-end gap-2">
                            <button className="text-xs text-indigo-600 hover:underline" onClick={() => handleToggleExclude(e)}>
                              {e.excluded ? t('sensitiveData.restore') : t('sensitiveData.remove')}
                            </button>
                            {e.origin === 'manual' && (
                              <button
                                className="text-xs text-red-600 hover:underline"
                                onClick={() => handleRemoveManual(e)}
                              >
                                {t('common.delete')}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
