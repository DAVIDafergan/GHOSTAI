import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, Anomaly, AnomalyReason } from '../api/client';
import { useSession } from '../context/SessionContext';
import { COLORS } from '../colors';

export function AnomalyWidget() {
  const { session } = useSession();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [anomalies, setAnomalies] = useState<Anomaly[] | null>(null);
  const [windowDays, setWindowDays] = useState(7);

  useEffect(() => {
    if (!session) return;
    api
      .getAnomalies(session)
      .then((res) => {
        setAnomalies(res.anomalies);
        setWindowDays(res.windowDays);
      })
      .catch(() => setAnomalies([]));
  }, [session]);

  if (anomalies === null) return null; // still loading - avoid a flash of "all clear"
  if (anomalies.length === 0) {
    return (
      <div className={`card flex items-center gap-2 border-s-4 ${COLORS.ok} border-green-500`}>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLORS.okDot}`} />
        <p className="text-sm">{t('anomaly.allClear', { days: windowDays })}</p>
      </div>
    );
  }

  return (
    <div className="card border-s-4 border-orange-500">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
        <span className={`h-2.5 w-2.5 rounded-full ${COLORS.warningDot}`} />
        {t('anomaly.headline', { count: anomalies.length, days: windowDays })}
      </h2>
      <div className="space-y-2">
        {anomalies.map((a) => (
          <div
            key={a.employeeId}
            className="flex cursor-pointer items-center justify-between rounded-lg bg-orange-50 p-3 transition-colors hover:bg-orange-100"
            onClick={() => navigate(`/employees/${a.employeeId}`)}
          >
            <div>
              <p className="text-sm font-medium">{a.name || a.email}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {a.reasons.map((r: AnomalyReason) => (
                  <span key={r.type} className={`rounded px-2 py-0.5 text-xs ${COLORS.warning}`} title={r.detail}>
                    {t(`anomaly.reasons.${r.type}`)}
                  </span>
                ))}
              </div>
            </div>
            <span className="shrink-0 text-xs text-gray-500">{t('anomaly.blocksThisWeek', { count: a.blocksThisWeek })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
