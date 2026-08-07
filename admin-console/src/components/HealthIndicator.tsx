import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, HealthCheckResult } from '../api/client';
import { useSession } from '../context/SessionContext';
import { COLORS } from '../colors';

const POLL_INTERVAL_MS = 60_000;

/**
 * Always-visible proof the detection pipeline is actually alive, without
 * opening devtools: an hourly backend cron re-verifies a known canary
 * entity is still found (see HealthCheckService). This just displays the
 * latest result and lets you trigger one on demand.
 */
export function HealthIndicator() {
  const { session } = useSession();
  const { t, i18n } = useTranslation();
  const [check, setCheck] = useState<HealthCheckResult | null>(null);
  const [checkedOnce, setCheckedOnce] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);

  const refresh = () => {
    if (!session) return;
    api
      .getLatestHealthCheck(session)
      .then(setCheck)
      .catch(() => setCheck(null))
      .finally(() => setCheckedOnce(true));
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function handleRunNow() {
    if (!session) return;
    setRunning(true);
    try {
      await api.runHealthCheck(session);
      refresh();
    } finally {
      setRunning(false);
    }
  }

  if (!checkedOnce) return null;

  if (!check) {
    return (
      <div className="mb-4 space-y-1">
        <div className={`rounded-lg px-3 py-2 text-xs ${COLORS.neutral}`}>{t('health.notYetRun')}</div>
        <button className="btn-secondary w-full text-xs" onClick={handleRunNow} disabled={running}>
          {running ? t('health.running') : t('health.runNow')}
        </button>
      </div>
    );
  }

  const isHealthy = check.success;
  const locale = i18n.language === 'he' ? 'he-IL' : 'en-US';

  return (
    <div className="mb-4">
      <button
        type="button"
        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs ${isHealthy ? COLORS.ok : COLORS.critical}`}
        onClick={() => setExpanded((v) => !v)}
      >
        <span>{isHealthy ? '🟢' : '🔴'}</span>
        <span className="flex-1 text-start">{isHealthy ? t('health.systemActive') : t('health.lastCheckFailed')}</span>
      </button>
      <p className="mt-1 px-1 text-[11px] text-gray-400">
        {t('health.lastChecked', { time: new Date(check.ranAt).toLocaleString(locale) })}
      </p>
      {expanded && (
        <div className="mt-2 space-y-2 rounded-lg border border-gray-200 p-3 text-xs">
          {!isHealthy && check.detail && <p className="text-red-600">{check.detail}</p>}
          <button className="btn-secondary w-full text-xs" onClick={handleRunNow} disabled={running}>
            {running ? t('health.running') : t('health.runNow')}
          </button>
        </div>
      )}
    </div>
  );
}
