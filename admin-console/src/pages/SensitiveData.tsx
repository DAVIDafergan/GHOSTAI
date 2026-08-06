import { useEffect, useState } from 'react';
import { useSession } from '../context/SessionContext';
import {
  connectorApi,
  ConnectorApiError,
  ConnectorEntity,
  ConnectorHealth,
  loadConnectorUrl,
  saveConnectorUrl,
} from '../api/connectorClient';
import { ENTITY_TYPE_LABELS, ALL_ENTITY_TYPES } from '../entityTypes';
import { COLORS } from '../colors';

type ConnectionState = 'checking' | 'unreachable' | 'connected' | 'unset';

export function SensitiveData() {
  const { session } = useSession();
  const [connectorUrl, setConnectorUrl] = useState(loadConnectorUrl() ?? '');
  const [urlInput, setUrlInput] = useState(connectorUrl);
  const [state, setState] = useState<ConnectionState>(connectorUrl ? 'checking' : 'unset');
  const [health, setHealth] = useState<ConnectorHealth | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

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
      setErrorDetail(err instanceof ConnectorApiError ? err.message : 'שגיאה לא ידועה');
    }
  }

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
      setErrorDetail(err instanceof ConnectorApiError ? err.message : 'שגיאה לא ידועה');
    } finally {
      setLoadingEntities(false);
    }
  }

  useEffect(() => {
    loadEntities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, entityType, search, status, since]);

  function handleSaveUrl(e: React.FormEvent) {
    e.preventDefault();
    saveConnectorUrl(urlInput);
    setConnectorUrl(urlInput.trim().replace(/\/$/, ''));
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
      setManualError(err instanceof ConnectorApiError ? err.message : 'שגיאה בהוספה');
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
      setExportError(err instanceof ConnectorApiError ? err.message : 'שגיאה בייצוא');
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
          return { value: value ?? '', entityType: type ?? '', error: 'שורה לא תקינה - נדרש value,entityType' };
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
        updated[i] = { ...updated[i], error: err instanceof ConnectorApiError ? err.message : 'שגיאה' };
      }
    }
    setBulkRows(updated);
    setBulkProcessing(false);
    await Promise.all([loadEntities(), refreshHealth()]);
  }

  if (state === 'unset') {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold">מידע רגיש</h1>
        <div className="card max-w-lg">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">חיבור ל-connector</h2>
          <p className="mb-4 text-sm text-gray-600">
            הכרטיסייה הזו מתחברת <b>ישירות</b> ל-connector שרץ אצלכם ברשת - לא דרך שרת PII Shield המרכזי,
            שלעולם לא רואה ערכים גולמיים. הזינו את הכתובת שבה ה-connector נגיש מהדפדפן הזה (למשל{' '}
            <code dir="ltr">http://localhost:4100</code>).
          </p>
          <form onSubmit={handleSaveUrl} className="flex gap-2">
            <input
              className="input"
              placeholder="http://localhost:4100"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              required
            />
            <button type="submit" className="btn-primary shrink-0">
              התחבר
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">מידע רגיש</h1>
        <button
          className="text-xs text-gray-500 hover:underline"
          onClick={() => {
            setState('unset');
            setUrlInput(connectorUrl);
          }}
        >
          שנה כתובת connector
        </button>
      </div>

      {state === 'checking' && (
        <div className={`card flex items-center gap-2 ${COLORS.neutral}`}>
          <span className={`h-2.5 w-2.5 shrink-0 animate-pulse rounded-full ${COLORS.neutralDot}`} />
          <p className="text-sm">מתחבר ל-connector...</p>
        </div>
      )}

      {state === 'unreachable' && (
        <div className={`card border-r-4 border-red-500 ${COLORS.critical}`}>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLORS.criticalDot}`} />
            <p className="text-sm font-medium">לא ניתן להתחבר ל-connector</p>
          </div>
          <p className="mt-2 text-xs text-gray-600">
            כתובת: <code dir="ltr">{connectorUrl}</code>
            {errorDetail && (
              <>
                {' - '}
                {errorDetail}
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            ודאו שה-connector רץ (מצב daemon עם apiPort מוגדר), שיש לו גישה רשתית מהדפדפן הזה, ושכתובת ה-URL
            נכונה. אם ה-admin console נגיש דרך HTTPS וה-connector דרך HTTP רגיל בכתובת שאינה localhost, ייתכן
            שהדפדפן חוסם את הבקשה (mixed content) - הריצו את הבדיקה מדפדפן שנמצא באותה רשת מקומית, או הגדירו
            TLS/מנהרה עבור ה-connector.
          </p>
          <button className="btn-secondary mt-3 text-xs" onClick={() => checkConnection(connectorUrl)}>
            נסה שוב
          </button>
        </div>
      )}

      {state === 'connected' && (
        <>
          <div className={`card flex items-center gap-4 border-r-4 border-green-500`}>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLORS.okDot}`} />
            <p className="text-sm">
              מחובר - {health?.activeCount} ישויות פעילות במעקב ({health?.entityCount} סה"כ, כולל לא-פעילות)
            </p>
          </div>

          <div className="card">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">הוספת ישות ידנית</h2>
            <form onSubmit={handleAddManual} className="flex items-end gap-2">
              <input
                className="input"
                placeholder="הערך (למשל שם מלא)"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                required
              />
              <select className="input" value={manualType} onChange={(e) => setManualType(e.target.value)}>
                {ALL_ENTITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ENTITY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-primary shrink-0">
                הוסף למעקב
              </button>
            </form>
            {manualError && <p className="mt-2 text-sm text-red-600">{manualError}</p>}
          </div>

          <div className="card">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">
              הסרה קבוצתית ממעקב (CSV, עמודות: value,entityType)
            </h2>
            <p className="mb-3 text-xs text-gray-500">
              לדוגמה: <code dir="ltr">דוד לוי,name</code> - שימושי לבקשות "זכות להישכח" שמשפיעות על הרבה
              ערכים בבת אחת.
            </p>
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
                          שורה {i + 1}: {row.value} ({row.entityType})
                        </td>
                        <td className="py-1">{row.error ?? (row.done ? '✓ הוסר ממעקב' : 'ממתין')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn-primary" onClick={handleConfirmBulkExclude} disabled={bulkProcessing}>
                  {bulkProcessing
                    ? 'מעבד...'
                    : `הסר ${bulkRows.filter((r) => !r.error && !r.done).length} ישויות ממעקב`}
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">סוג</label>
                  <select className="input" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
                    <option value="">הכל</option>
                    {ALL_ENTITY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {ENTITY_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">סטטוס</label>
                  <select
                    className="input"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'excluded' | '')}
                  >
                    <option value="">הכל</option>
                    <option value="active">פעיל במעקב</option>
                    <option value="excluded">הוסר ממעקב</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">זוהה מתאריך</label>
                  <input type="date" className="input" value={since} onChange={(e) => setSince(e.target.value)} />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-500">חיפוש</label>
                  <input
                    className="input"
                    placeholder="חיפוש לפי ערך..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <button className="btn-secondary shrink-0 text-xs" onClick={handleExportCsv} disabled={exporting}>
                {exporting ? 'מייצא...' : 'ייצוא ל-CSV (לפי הסינון הנוכחי)'}
              </button>
            </div>
            {exportError && <p className="mb-3 text-sm text-red-600">{exportError}</p>}

            {loadingEntities ? (
              <p className="text-sm text-gray-500">טוען...</p>
            ) : entities.length === 0 ? (
              <p className="text-sm text-gray-400">לא נמצאו ישויות התואמות את הסינון.</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-gray-500">
                  מציג {entities.length} מתוך {total}
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right text-gray-500">
                      <th className="pb-2">ערך</th>
                      <th className="pb-2">סוג</th>
                      <th className="pb-2">זוהה לראשונה</th>
                      <th className="pb-2">נראה לאחרונה</th>
                      <th className="pb-2">מקור</th>
                      <th className="pb-2">סטטוס</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {entities.map((e) => (
                      <tr key={`${e.entityType}:${e.value}`} className="border-b last:border-0">
                        <td className="py-2 font-mono">{e.value}</td>
                        <td className="py-2">{ENTITY_TYPE_LABELS[e.entityType] ?? e.entityType}</td>
                        <td className="py-2 text-gray-500">{new Date(e.firstSeenAt).toLocaleDateString('he-IL')}</td>
                        <td className="py-2 text-gray-500">{new Date(e.lastSeenAt).toLocaleDateString('he-IL')}</td>
                        <td className="py-2 text-gray-500">{e.origin === 'manual' ? 'ידני' : 'סנכרון אוטומטי'}</td>
                        <td className="py-2">
                          <span className={`rounded px-2 py-0.5 text-xs ${e.excluded ? COLORS.warning : COLORS.ok}`}>
                            {e.excluded ? 'הוסר ממעקב' : 'פעיל במעקב'}
                          </span>
                        </td>
                        <td className="py-2 text-left">
                          <div className="flex justify-end gap-2">
                            <button className="text-xs text-indigo-600 hover:underline" onClick={() => handleToggleExclude(e)}>
                              {e.excluded ? 'החזר למעקב' : 'הסר ממעקב'}
                            </button>
                            {e.origin === 'manual' && (
                              <button
                                className="text-xs text-red-600 hover:underline"
                                onClick={() => handleRemoveManual(e)}
                              >
                                מחק
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
    </div>
  );
}
