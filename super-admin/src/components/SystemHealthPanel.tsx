import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { api, SystemHealthCheck } from '../api/client';
import { useSession } from '../context/SessionContext';
import { COLORS } from '../colors';

const CHAIN_STEP_ORDER = ['companyCreate', 'employeeCreate', 'blockSimulate', 'auditVerify', 'dashboardVerify', 'cleanup'];

interface HealthBarTooltipProps {
  active?: boolean;
  label?: string;
  payload?: { payload: { success: boolean } }[];
  okLabel: string;
  failLabel: string;
}

function HealthBarTooltip({ active, label, payload, okLabel, failLabel }: HealthBarTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const success = payload[0].payload.success;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs shadow-sm">
      <p className="text-gray-500">{label}</p>
      <p className={success ? 'text-green-700' : 'text-red-600'}>{success ? okLabel : failLabel}</p>
    </div>
  );
}

export function SystemHealthPanel() {
  const { session } = useSession();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'he' ? 'he-IL' : 'en-US';
  const [history, setHistory] = useState<SystemHealthCheck[] | null>(null);
  const [running, setRunning] = useState(false);

  const refresh = async () => {
    if (!session) return;
    setHistory(await api.getSystemHealthHistory(session, 100));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function handleRunNow() {
    if (!session) return;
    setRunning(true);
    try {
      await api.runSystemHealthCheckNow(session);
      await refresh();
    } finally {
      setRunning(false);
    }
  }

  if (history === null) {
    return (
      <div className="card">
        <p className="text-sm text-gray-500">{t('health.loading')}</p>
      </div>
    );
  }

  const chronological = [...history].reverse();
  const chartData = chronological.map((h) => ({
    time: new Date(h.ranAt).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    value: 1,
    success: h.success,
  }));
  const last30 = history.slice(0, 30);
  const successRate = last30.length > 0 ? Math.round((last30.filter((h) => h.success).length / last30.length) * 100) : null;
  const latest = history[0] ?? null;

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">{t('health.title')}</h2>
          <p className="text-xs text-gray-500">{t('health.subtitle')}</p>
        </div>
        <button className="btn-secondary text-xs" onClick={handleRunNow} disabled={running}>
          {running ? '...' : '▶'}
        </button>
      </div>

      {history.length === 0 ? (
        <p className="text-sm text-gray-400">{t('health.noHistory')}</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500">{t('health.successRate')}</p>
              <p className={`text-2xl font-bold ${successRate !== null && successRate < 100 ? 'text-orange-600' : 'text-green-700'}`}>
                {successRate}%
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">{t('health.lastRun')}</p>
              <p className="text-sm font-medium">
                {latest ? (
                  <span className={latest.success ? 'text-green-700' : 'text-red-600'}>
                    {latest.success ? t('health.resultOk') : t('health.resultFail')}
                  </span>
                ) : (
                  '-'
                )}
              </p>
              {latest && <p className="text-xs text-gray-400">{new Date(latest.ranAt).toLocaleString(locale)}</p>}
            </div>
          </div>

          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" fontSize={10} hide />
              <YAxis hide domain={[0, 1]} />
              <Tooltip content={<HealthBarTooltip okLabel={t('health.resultOk')} failLabel={t('health.resultFail')} />} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.success ? '#22c55e' : '#dc2626'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {latest?.steps && (
            <div className="mt-4 flex flex-wrap gap-2">
              {CHAIN_STEP_ORDER.map((key) => {
                const step = latest.steps?.find((s) => s.key === key);
                if (!step) return null;
                return (
                  <span
                    key={key}
                    title={step.detail}
                    className={`rounded px-2 py-0.5 text-xs ${step.success ? COLORS.ok : COLORS.critical}`}
                  >
                    {step.success ? '✓' : '✗'} {t(`health.chainStep.${key}`)}
                  </span>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
