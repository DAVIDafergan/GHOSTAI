import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, EmployeeSummary } from '../api/client';
import { useSession } from '../context/SessionContext';
import { COLORS } from '../colors';

const STATUS_LABEL: Record<EmployeeSummary['status'], string> = {
  active: 'פעיל',
  not_installed: 'לא הותקן עדיין',
  inactive: 'לא פעיל 30+ יום',
  disabled: 'מושבת',
};

const STATUS_COLOR: Record<EmployeeSummary['status'], string> = {
  active: COLORS.ok,
  not_installed: COLORS.neutral,
  inactive: COLORS.warning,
  disabled: COLORS.critical,
};

export function Employees() {
  const { session } = useSession();
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newExtensionKey, setNewExtensionKey] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<{ email: string; name?: string; error?: string }[] | null>(null);
  const [importing, setImporting] = useState(false);

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
        err instanceof ApiError && err.status === 409
          ? 'עובד עם המייל הזה כבר קיים.'
          : 'שגיאה בהוספת העובד. בדוק את כתובת המייל.',
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
          : { email: emailPart, error: 'כתובת מייל לא תקינה' };
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
          error: err instanceof ApiError && err.status === 409 ? 'כבר קיים' : 'שגיאה',
        };
      }
    }
    setCsvRows(updated);
    setImporting(false);
    await refresh();
  }

  if (loading) return <p className="text-gray-500">טוען...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">ניהול עובדים</h1>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">הוספת עובד בודד</h2>
        <form onSubmit={handleAdd} className="flex items-end gap-2">
          <input
            type="text"
            className="input"
            placeholder="שם (אופציונלי)"
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
            הוסף
          </button>
        </form>
        {addError && <p className="mt-2 text-sm text-red-600">{addError}</p>}
        {newExtensionKey && (
          <div className="mt-3 rounded-lg bg-gray-100 p-3 text-xs">
            <p className="mb-1 text-gray-500">קוד התקנה לעובד (מוצג פעם אחת):</p>
            <code className="break-all text-green-700">{newExtensionKey}</code>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          ייבוא המוני (CSV, עמודות: מייל, שם - אופציונלי)
        </h2>
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
                      שורה {i + 1}: {row.email} {row.name ? `(${row.name})` : ''}
                    </td>
                    <td className="py-1">{row.error ?? '✓'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn-primary" onClick={handleConfirmImport} disabled={importing}>
              {importing ? 'מייבא...' : `ייבא ${csvRows.filter((r) => !r.error).length} עובדים`}
            </button>
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-right text-gray-500">
              <th className="pb-2">שם</th>
              <th className="pb-2">מייל</th>
              <th className="pb-2">סטטוס</th>
              <th className="pb-2">הצטרף</th>
              <th className="pb-2">חסימות סה"כ</th>
              <th className="pb-2">פעילות אחרונה</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr
                key={emp.id}
                className="cursor-pointer border-b last:border-0 hover:bg-gray-50"
                onClick={() => navigate(`/employees/${emp.id}`)}
              >
                <td className="py-2">{emp.name || <span className="text-gray-400">-</span>}</td>
                <td className="py-2">{emp.email}</td>
                <td className="py-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLOR[emp.status]}`}>
                    {STATUS_LABEL[emp.status]}
                  </span>
                </td>
                <td className="py-2">{new Date(emp.createdAt).toLocaleDateString('he-IL')}</td>
                <td className="py-2 font-medium">{emp.blockCount}</td>
                <td className="py-2 text-gray-500">
                  {emp.lastActiveAt ? new Date(emp.lastActiveAt).toLocaleDateString('he-IL') : '-'}
                </td>
                <td className="py-2 text-left">
                  {emp.status !== 'disabled' && (
                    <button
                      className="text-xs text-red-600 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDisable(emp.id);
                      }}
                    >
                      השבת
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
