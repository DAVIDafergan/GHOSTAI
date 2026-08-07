import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { api, ApiError, EmployeeSummary } from '../api/client';
import { useSession } from '../context/SessionContext';
import { COLORS } from '../colors';
import { HelpTooltip } from '../components/HelpTooltip';

export function Employees() {
  const { session } = useSession();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'he' ? 'he-IL' : 'en-US';
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newExtensionKey, setNewExtensionKey] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<{ email: string; name?: string; error?: string }[] | null>(null);
  const [importing, setImporting] = useState(false);

  const STATUS_COLOR: Record<EmployeeSummary['status'], string> = {
    active: COLORS.ok,
    not_installed: COLORS.neutral,
    inactive: COLORS.warning,
    disabled: COLORS.critical,
  };

  const refresh = async () => {
    if (!session) return;
    setEmployees(await api.listEmployees(session));
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setAddError(null);
    try {
      const result = await api.createEmployee(session, newEmail, newName || undefined);
      setNewExtensionKey(result.extensionKey);
      setNewName('');
      setNewEmail('');
      await refresh();
    } catch (err) {
      setAddError(
        err instanceof ApiError && err.status === 409 ? t('employees.duplicateEmailError') : t('employees.addError'),
      );
    }
  }

  async function handleDisable(id: string) {
    if (!session) return;
    await api.disableEmployee(session, id);
    await refresh();
  }

  function handleCsvSelected(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const rows = lines.map((line) => {
        const [emailPart, namePart] = line.split(',').map((s) => s.trim());
        return emailRe.test(emailPart)
          ? { email: emailPart, name: namePart || undefined }
          : { email: emailPart, error: t('employees.invalidEmail') };
      });
      setCsvRows(rows);
    };
    reader.readAsText(file);
  }

  async function handleConfirmImport() {
    if (!session || !csvRows) return;
    setImporting(true);
    const updated = [...csvRows];
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].error) continue;
      try {
        await api.createEmployee(session, updated[i].email, updated[i].name);
      } catch (err) {
        updated[i] = {
          ...updated[i],
          error: err instanceof ApiError && err.status === 409 ? t('employees.alreadyExists') : t('employees.genericError'),
        };
      }
    }
    setCsvRows(updated);
    setImporting(false);
    await refresh();
  }

  if (loading) return <p className="text-gray-500">{t('common.loading')}</p>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      <h1 className="flex items-center gap-2 text-xl font-bold">
        {t('employees.title')}
        <HelpTooltip topic="employees" />
      </h1>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('employees.addOne')}</h2>
        <form onSubmit={handleAdd} className="flex items-end gap-2">
          <input
            type="text"
            className="input"
            placeholder={t('employees.namePlaceholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            type="email"
            className="input"
            placeholder="employee@company.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
          />
          <button type="submit" className="btn-primary shrink-0">
            {t('employees.add')}
          </button>
        </form>
        {addError && <p className="mt-2 text-sm text-red-600">{addError}</p>}
        {newExtensionKey && (
          <div className="mt-3 rounded-lg bg-gray-100 p-3 text-xs">
            <p className="mb-1 text-gray-500">{t('employees.installCodeLabel')}</p>
            <code className="break-all text-green-700">{newExtensionKey}</code>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('employees.csvColumnsHelp')}</h2>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => e.target.files?.[0] && handleCsvSelected(e.target.files[0])}
        />
        {csvRows && (
          <div className="mt-3 space-y-2">
            <table className="w-full text-sm">
              <tbody>
                {csvRows.map((row, i) => (
                  <tr key={i} className={row.error ? 'text-red-600' : ''}>
                    <td className="py-1">
                      {t('employees.rowLabel', { n: i + 1 })}: {row.email} {row.name ? `(${row.name})` : ''}
                    </td>
                    <td className="py-1">{row.error ?? '✓'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn-primary" onClick={handleConfirmImport} disabled={importing}>
              {importing
                ? t('employees.importing')
                : t('employees.importCount', { count: csvRows.filter((r) => !r.error).length })}
            </button>
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-start text-gray-500">
              <th className="pb-2">{t('employees.table.name')}</th>
              <th className="pb-2">{t('employees.table.email')}</th>
              <th className="pb-2">{t('employees.table.status')}</th>
              <th className="pb-2">{t('employees.table.joined')}</th>
              <th className="pb-2">{t('employees.table.totalBlocks')}</th>
              <th className="pb-2">{t('employees.table.lastActive')}</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-sm text-gray-400">
                  {t('employees.noEmployees')}
                </td>
              </tr>
            )}
            {employees.map((emp) => (
              <tr
                key={emp.id}
                className="cursor-pointer border-b last:border-0 transition-colors hover:bg-gray-50"
                onClick={() => navigate(`/employees/${emp.id}`)}
              >
                <td className="py-2">{emp.name || <span className="text-gray-400">-</span>}</td>
                <td className="py-2">{emp.email}</td>
                <td className="py-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLOR[emp.status]}`}>
                    {t(`employees.status.${emp.status}`)}
                  </span>
                </td>
                <td className="py-2">{new Date(emp.createdAt).toLocaleDateString(locale)}</td>
                <td className="py-2 font-medium">{emp.blockCount}</td>
                <td className="py-2 text-gray-500">
                  {emp.lastActiveAt ? new Date(emp.lastActiveAt).toLocaleDateString(locale) : '-'}
                </td>
                <td className="py-2 text-end">
                  {emp.status !== 'disabled' && (
                    <button
                      className="text-xs text-red-600 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDisable(emp.id);
                      }}
                    >
                      {t('employees.disable')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
