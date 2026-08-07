import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import { api, AuditLogEntry, EmployeeSummary } from '../api/client';
import { useSession } from '../context/SessionContext';
import { COLORS } from '../colors';

export function EmployeeProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useSession();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'he' ? 'he-IL' : 'en-US';
  const BackIcon = i18n.language === 'he' ? ArrowRight : ArrowLeft;
  const [employee, setEmployee] = useState<EmployeeSummary | null>(null);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const STATUS_COLOR: Record<EmployeeSummary['status'], string> = {
    active: COLORS.ok,
    not_installed: COLORS.neutral,
    inactive: COLORS.warning,
    disabled: COLORS.critical,
  };

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

  if (loading) return <p className="text-gray-500">{t('common.loading')}</p>;
  if (error || !employee) return <p className="text-red-600">{t('employeeProfile.notFound')}</p>;

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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      <button
        onClick={() => navigate('/employees')}
        className="flex items-center gap-1 text-sm text-indigo-600 hover:underline"
      >
        <BackIcon className="h-3.5 w-3.5" />
        {t('employeeProfile.back')}
      </button>

      <div className="card flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{employee.name || employee.email}</h1>
          {employee.name && <p className="text-sm text-gray-500">{employee.email}</p>}
        </div>
        <span className={`rounded px-3 py-1 text-sm ${STATUS_COLOR[employee.status]}`}>
          {t(`employees.status.${employee.status}`)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="text-xs text-gray-500">{t('employeeProfile.totalBlocks')}</p>
          <p className="text-2xl font-bold text-red-600">{employee.blockCount}</p>
        </div>
        <div className="card">
          <p className="text-xs text-gray-500">{t('employeeProfile.joined')}</p>
          <p className="text-2xl font-bold">{new Date(employee.createdAt).toLocaleDateString(locale)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-gray-500">{t('employeeProfile.lastActive')}</p>
          <p className="text-2xl font-bold">
            {employee.lastActiveAt ? new Date(employee.lastActiveAt).toLocaleDateString(locale) : '-'}
          </p>
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('employeeProfile.blocksByDay')}</h2>
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
        <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('employeeProfile.historyTitle')}</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-gray-400">{t('employeeProfile.noHistory')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-start text-gray-500">
                <th className="pb-2">{t('employeeProfile.table.date')}</th>
                <th className="pb-2">{t('employeeProfile.table.eventType')}</th>
                <th className="pb-2">{t('employeeProfile.table.entityType')}</th>
                <th className="pb-2">{t('employeeProfile.table.platform')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b last:border-0">
                  <td className="py-2 text-gray-500">{new Date(log.createdAt).toLocaleString(locale)}</td>
                  <td className="py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        log.eventType === 'blocked' ? COLORS.critical : COLORS.neutral
                      }`}
                    >
                      {log.eventType === 'blocked' ? t('employeeProfile.blocked') : log.eventType}
                    </span>
                  </td>
                  <td className="py-2">{log.entityType ? t(`entityTypes.${log.entityType}`) : '-'}</td>
                  <td className="py-2 text-gray-500">{log.platform ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </motion.div>
  );
}
