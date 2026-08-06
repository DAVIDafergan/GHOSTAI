import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api, AuditLogEntry, DashboardSummary } from '../api/client';
import { useSession } from '../context/SessionContext';
import { AnomalyWidget } from '../components/AnomalyWidget';

export function Dashboard() {
  const { session } = useSession();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    Promise.all([api.getDashboardSummary(session), api.listAuditLogs(session)])
      .then(([s, l]) => {
        setSummary(s);
        setLogs(l.logs);
      })
      .finally(() => setLoading(false));
  }, [session]);

  if (loading) return <p className="text-gray-500">טוען...</p>;
  if (!summary) return <p className="text-red-600">שגיאה בטעינת הנתונים.</p>;

  const noDataYet = summary.totalEmployees === 0 && summary.connectors.length === 0;

  if (noDataYet) {
    return (
      <div className="card max-w-lg text-center">
        <h2 className="mb-2 text-lg font-semibold">עדיין אין נתונים</h2>
        <p className="mb-4 text-sm text-gray-600">
          ודא שהתוסף מותקן ופעיל אצל העובדים, ושה-connector רץ ומחובר.
        </p>
        <a href="#/employees" className="btn-primary inline-block">
          לניהול עובדים
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">לוח בקרה</h1>

      <AnomalyWidget />

      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-gray-500">חסימות החודש</p>
          <p className="text-2xl font-bold">{summary.blocksThisMonth}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">עובדים פעילים</p>
          <p className="text-2xl font-bold">
            {summary.activeEmployees} / {summary.totalEmployees}
          </p>
        </div>
        <div className="card">
          <p className="mb-1 text-sm text-gray-500">Connectors</p>
          <div className="space-y-1">
            {summary.connectors.length === 0 && <p className="text-sm text-gray-400">אין connector מחובר</p>}
            {summary.connectors.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <span
                  className={`h-2 w-2 rounded-full ${
                    c.status === 'connected' ? 'bg-green-500' : c.status === 'error' ? 'bg-red-500' : 'bg-amber-500'
                  }`}
                />
                {c.sourceType} - {c.status}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">חסימות ב-30 הימים האחרונים</h2>
        {summary.blocksByDay.length === 0 ? (
          <p className="text-sm text-gray-400">אין עדיין נתונים להצגה</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={summary.blocksByDay}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">יומן פעילות אחרון</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-gray-400">אין רשומות עדיין</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-right text-gray-500">
                <th className="pb-2">זמן</th>
                <th className="pb-2">עובד</th>
                <th className="pb-2">סוג</th>
                <th className="pb-2">פלטפורמה</th>
                <th className="pb-2">פעולה</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b last:border-0">
                  <td className="py-2">{new Date(log.createdAt).toLocaleString('he-IL')}</td>
                  <td className="py-2">{log.employeeName || log.employeeEmail}</td>
                  <td className="py-2">{log.entityType ?? '-'}</td>
                  <td className="py-2 text-gray-500">{log.platform ?? '-'}</td>
                  <td className="py-2">{log.eventType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
