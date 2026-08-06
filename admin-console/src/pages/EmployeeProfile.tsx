import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api, AuditLogEntry, EmployeeSummary } from '../api/client';
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

const ENTITY_TYPE_LABEL: Record<string, string> = {
  name: 'שם',
  id_number: 'ת.ז',
  case_number: 'מספר תיק',
  amount: 'סכום',
  email: 'אימייל',
  phone: 'טלפון',
};

export function EmployeeProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useSession();
  const [employee, setEmployee] = useState<EmployeeSummary | null>(null);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!session || !id) return;
    Promise.all([api.getEmployee(session, id), api.listAuditLogs(session, { employeeId: id })])
      .then(([emp, logsRes]) => {
        setEmployee(emp);
        setLogs(logsRes.logs);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [session, id]);

  if (loading) return <p className="text-gray-500">טוען...</p>;
  if (error || !employee) return <p className="text-red-600">לא נמצא עובד כזה.</p>;

  const blockedLogs = logs.filter((l) => l.eventType === 'blocked');
  const byDay = new Map<string, number>();
  for (const log of blockedLogs) {
    const day = log.createdAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const chartData = Array.from(byDay.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-6">
      <button onClick={() => navigate('/employees')} className="text-sm text-indigo-600 hover:underline">
        ← חזרה לעובדים
      </button>

      <div className="card flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{employee.name || employee.email}</h1>
          {employee.name && <p className="text-sm text-gray-500">{employee.email}</p>}
        </div>
        <span className={`rounded px-3 py-1 text-sm ${STATUS_COLOR[employee.status]}`}>
          {STATUS_LABEL[employee.status]}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="text-xs text-gray-500">חסימות סה"כ</p>
          <p className="text-2xl font-bold text-red-600">{employee.blockCount}</p>
        </div>
        <div className="card">
          <p className="text-xs text-gray-500">הצטרף</p>
          <p className="text-2xl font-bold">{new Date(employee.createdAt).toLocaleDateString('he-IL')}</p>
        </div>
        <div className="card">
          <p className="text-xs text-gray-500">פעילות אחרונה</p>
          <p className="text-2xl font-bold">
            {employee.lastActiveAt ? new Date(employee.lastActiveAt).toLocaleDateString('he-IL') : '-'}
          </p>
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">חסימות לפי יום</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Bar dataKey="count" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card overflow-x-auto">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">היסטוריית חסימות</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-gray-400">אין עדיין אירועים לעובד זה.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-right text-gray-500">
                <th className="pb-2">זמן</th>
                <th className="pb-2">סוג אירוע</th>
                <th className="pb-2">סוג ישות</th>
                <th className="pb-2">פלטפורמה</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b last:border-0">
                  <td className="py-2 text-gray-500">{new Date(log.createdAt).toLocaleString('he-IL')}</td>
                  <td className="py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        log.eventType === 'blocked' ? COLORS.critical : COLORS.neutral
                      }`}
                    >
                      {log.eventType === 'blocked' ? 'נחסם' : log.eventType}
                    </span>
                  </td>
                  <td className="py-2">{log.entityType ? ENTITY_TYPE_LABEL[log.entityType] ?? log.entityType : '-'}</td>
                  <td className="py-2 text-gray-500">{log.platform ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
