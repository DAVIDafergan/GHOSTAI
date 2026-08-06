import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Anomaly, AnomalyReason } from '../api/client';
import { useSession } from '../context/SessionContext';
import { COLORS } from '../colors';

const REASON_LABEL: Record<AnomalyReason['type'], string> = {
  high_blocks: 'חסימות גבוהות משמעותית מהרגיל',
  repeated_override: 'ניסיונות חוזרים לעקוף חסימה',
  unusual_hours: 'פעילות בשעות לא רגילות',
};

export function AnomalyWidget() {
  const { session } = useSession();
  const navigate = useNavigate();
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
      <div className={`card flex items-center gap-2 border-r-4 ${COLORS.ok} border-green-500`}>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLORS.okDot}`} />
        <p className="text-sm">לא זוהו דפוסי פעילות חריגים ב-{windowDays} הימים האחרונים.</p>
      </div>
    );
  }

  return (
    <div className="card border-r-4 border-orange-500">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
        <span className={`h-2.5 w-2.5 rounded-full ${COLORS.warningDot}`} />
        זיהוי חריגות - {anomalies.length} עובדים לבדיקה (ב-{windowDays} הימים האחרונים)
      </h2>
      <div className="space-y-2">
        {anomalies.map((a) => (
          <div
            key={a.employeeId}
            className="flex cursor-pointer items-center justify-between rounded-lg bg-orange-50 p-3 hover:bg-orange-100"
            onClick={() => navigate(`/employees/${a.employeeId}`)}
          >
            <div>
              <p className="text-sm font-medium">{a.name || a.email}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {a.reasons.map((r) => (
                  <span key={r.type} className={`rounded px-2 py-0.5 text-xs ${COLORS.warning}`} title={r.detail}>
                    {REASON_LABEL[r.type]}
                  </span>
                ))}
              </div>
            </div>
            <span className="shrink-0 text-xs text-gray-500">{a.blocksThisWeek} חסימות השבוע</span>
          </div>
        ))}
      </div>
    </div>
  );
}
