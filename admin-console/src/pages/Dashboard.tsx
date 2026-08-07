import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { api, AuditLogEntry, DashboardSummary } from '../api/client';
import { useSession } from '../context/SessionContext';
import { AnomalyWidget } from '../components/AnomalyWidget';
import { HelpTooltip } from '../components/HelpTooltip';

export function Dashboard() {
  const { session } = useSession();
  const { t, i18n } = useTranslation();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const locale = i18n.language === 'he' ? 'he-IL' : 'en-US';

  useEffect(() => {
    if (!session) return;
    Promise.all([api.getDashboardSummary(session), api.listAuditLogs(session)])
      .then(([s, l]) => {
        setSummary(s);
        setLogs(l.logs);
      })
      .finally(() => setLoading(false));
  }, [session]);

  if (loading) return <p className="text-gray-500">{t('dashboard.loading')}</p>;
  if (!summary) return <p className="text-red-600">{t('dashboard.loadError')}</p>;

  const noDataYet = summary.totalEmployees === 0 && summary.connectors.length === 0;

  if (noDataYet) {
    return (
      <div className="card max-w-lg text-center">
        <h2 className="mb-2 text-lg font-semibold">{t('dashboard.noDataTitle')}</h2>
        <p className="mb-4 text-sm text-gray-600">{t('dashboard.noDataBody')}</p>
        <a href="#/employees" className="btn-primary inline-block">
          {t('dashboard.noDataCta')}
        </a>
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
      <h1 className="flex items-center gap-2 text-xl font-bold">
        {t('dashboard.title')}
        <HelpTooltip topic="dashboard" />
      </h1>

      <AnomalyWidget />

      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-gray-500">{t('dashboard.blocksThisMonth')}</p>
          <p className="text-2xl font-bold">{summary.blocksThisMonth}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">{t('dashboard.activeEmployees')}</p>
          <p className="text-2xl font-bold">
            {summary.activeEmployees} / {summary.totalEmployees}
          </p>
        </div>
        <div className="card">
          <p className="mb-1 text-sm text-gray-500">{t('dashboard.connectors')}</p>
          <div className="space-y-1">
            {summary.connectors.length === 0 && <p className="text-sm text-gray-400">{t('dashboard.noConnectors')}</p>}
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
        <h2 className="mb-4 text-sm font-semibold text-gray-700">{t('dashboard.blocksChartTitle')}</h2>
        {summary.blocksByDay.length === 0 ? (
          <p className="text-sm text-gray-400">{t('dashboard.noChartData')}</p>
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

      <div className="card overflow-x-auto">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">{t('dashboard.recentActivityTitle')}</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-gray-400">{t('dashboard.noRecentActivity')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-start text-gray-500">
                <th className="pb-2">{t('dashboard.table.date')}</th>
                <th className="pb-2">{t('dashboard.table.employee')}</th>
                <th className="pb-2">{t('dashboard.table.type')}</th>
                <th className="pb-2">{t('dashboard.table.platform')}</th>
                <th className="pb-2">{t('dashboard.table.action')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b last:border-0">
                  <td className="py-2">{new Date(log.createdAt).toLocaleString(locale)}</td>
                  <td className="py-2">{log.employeeName || log.employeeEmail}</td>
                  <td className="py-2">{log.entityType ? t(`entityTypes.${log.entityType}`) : '-'}</td>
                  <td className="py-2 text-gray-500">{log.platform ?? '-'}</td>
                  <td className="py-2">{log.eventType === 'blocked' ? t('employeeProfile.blocked') : log.eventType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </motion.div>
  );
}
