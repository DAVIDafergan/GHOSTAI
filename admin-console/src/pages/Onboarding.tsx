import { useEffect, useState } from 'react';
import { api, ApiError, ConnectorSummary } from '../api/client';
import { useSession } from '../context/SessionContext';

const DRAFT_KEY = 'piiShieldOnboardingDraft';

interface Draft {
  step: number;
  backendUrl: string;
  companyId?: string;
  apiKey?: string;
  connectorId?: string;
  sourceType?: string;
}

function loadDraft(): Draft {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return { step: 1, backendUrl: '' };
  try {
    return JSON.parse(raw) as Draft;
  } catch {
    return { step: 1, backendUrl: '' };
  }
}

function saveDraft(draft: Draft): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

const SOURCE_TYPES: { value: string; label: string; available: boolean }[] = [
  { value: 'postgres', label: 'PostgreSQL', available: true },
  { value: 'csv', label: 'קובץ CSV', available: true },
  { value: 'salesforce', label: 'Salesforce (בקרוב)', available: false },
  { value: 'generic_api', label: 'API כללי (בקרוב)', available: false },
];

export function Onboarding() {
  // Persisted across reloads so closing the browser mid-wizard resumes
  // instead of restarting (and, critically, doesn't create a second
  // company on step 1 - spec 6.5's onboarding edge case).
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const { login } = useSession();

  const update = (patch: Partial<Draft>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      saveDraft(next);
      return next;
    });
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center p-8" dir="rtl">
      <h1 className="mb-2 text-2xl font-bold text-indigo-700">הקמת PII Shield</h1>
      <p className="mb-8 text-sm text-gray-500">שלב {draft.step} מתוך 4</p>
      {draft.step === 1 && <StepCompanyDetails draft={draft} onNext={update} />}
      {draft.step === 2 && <StepConnectSource draft={draft} onNext={update} />}
      {draft.step === 3 && <StepInitialSync draft={draft} onNext={update} />}
      {draft.step === 4 && (
        <StepDone
          draft={draft}
          onFinish={() => {
            login({ backendUrl: draft.backendUrl, apiKey: draft.apiKey as string });
            localStorage.removeItem(DRAFT_KEY);
          }}
        />
      )}
    </div>
  );
}

function StepCompanyDetails({ draft, onNext }: { draft: Draft; onNext: (patch: Partial<Draft>) => void }) {
  const [backendUrl, setBackendUrl] = useState(draft.backendUrl || 'http://localhost:3000');
  const [adminSecret, setAdminSecret] = useState('');
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api.createCompany(backendUrl, adminSecret, name, adminEmail || undefined);
      onNext({ step: 2, backendUrl, companyId: result.id, apiKey: result.apiKey });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'קוד ההפעלה שגוי. פנה לספק השירות לקבלת הקוד הנכון.'
          : 'לא ניתן היה ליצור את החברה. ודא שכתובת השרת נכונה ושהשרת פעיל.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="כתובת שרת ה-backend">
        <input
          className="input"
          value={backendUrl}
          onChange={(e) => setBackendUrl(e.target.value)}
          required
        />
      </Field>
      <Field label="קוד הפעלה מספק השירות">
        <input className="input" value={adminSecret} onChange={(e) => setAdminSecret(e.target.value)} required />
      </Field>
      <Field label="שם החברה">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="מייל מנהל (אופציונלי)">
        <input
          type="email"
          className="input"
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
        />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? 'יוצר חברה...' : 'המשך'}
      </button>
    </form>
  );
}

function StepConnectSource({ draft, onNext }: { draft: Draft; onNext: (patch: Partial<Draft>) => void }) {
  const [sourceType, setSourceType] = useState(draft.sourceType ?? 'postgres');
  const [connectorId, setConnectorId] = useState(draft.connectorId);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<'ok' | 'not-yet' | null>(null);
  const session = { backendUrl: draft.backendUrl, apiKey: draft.apiKey as string };

  async function handleCreateConnector() {
    const connector = await api.createConnector(session, sourceType);
    setConnectorId(connector.id);
  }

  async function handleCheckConnection() {
    if (!connectorId) return;
    setChecking(true);
    try {
      const connectors = await api.listConnectors(session);
      const match = connectors.find((c) => c.id === connectorId);
      setCheckResult(match && match.status !== 'pending' ? 'ok' : 'not-yet');
    } finally {
      setChecking(false);
    }
  }

  const dockerCommand = connectorId
    ? `docker run -v $(pwd)/connector.config.json:/config/connector.config.json pii-shield-connector`
    : null;

  return (
    <div className="space-y-4">
      <Field label="סוג מקור הנתונים">
        <select
          className="input"
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value)}
          disabled={!!connectorId}
        >
          {SOURCE_TYPES.map((s) => (
            <option key={s.value} value={s.value} disabled={!s.available}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      {!connectorId && (
        <button className="btn-primary" onClick={handleCreateConnector}>
          צור חיבור
        </button>
      )}

      {connectorId && (
        <div className="space-y-3 rounded-lg bg-gray-100 p-4 text-sm">
          <p>
            הרץ את ה-connector ברשת שלכם עם ה-API key הבא (מוצג פעם אחת בלבד, שמור אותו במקום בטוח):
          </p>
          <code className="block break-all rounded bg-gray-800 p-2 text-xs text-green-300">
            {draft.apiKey}
          </code>
          <p>ולאחר מכן:</p>
          <code className="block break-all rounded bg-gray-800 p-2 text-xs text-green-300">{dockerCommand}</code>
          <button className="btn-secondary" onClick={handleCheckConnection} disabled={checking}>
            {checking ? 'בודק...' : 'בדוק חיבור'}
          </button>
          {checkResult === 'ok' && <p className="text-green-700">✓ מחובר</p>}
          {checkResult === 'not-yet' && (
            <p className="text-amber-700">
              ✗ עדיין לא זוהה חיבור מה-connector. ודא שהרצת אותו עם ה-API key הנכון ושיש לו גישה לשרת.
            </p>
          )}
        </div>
      )}

      <button
        className="btn-primary"
        disabled={!connectorId}
        onClick={() => onNext({ step: 3, connectorId, sourceType })}
      >
        המשך
      </button>
    </div>
  );
}

function StepInitialSync({ draft, onNext }: { draft: Draft; onNext: (patch: Partial<Draft>) => void }) {
  const [connector, setConnector] = useState<ConnectorSummary | null>(null);
  const [entitiesCount, setEntitiesCount] = useState(0);
  const session = { backendUrl: draft.backendUrl, apiKey: draft.apiKey as string };

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const [connectors, summary] = await Promise.all([
        api.listConnectors(session),
        api.getDashboardSummary(session),
      ]);
      if (cancelled) return;
      setConnector(connectors.find((c) => c.id === draft.connectorId) ?? null);
      setEntitiesCount(summary.entitiesCount);
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.connectorId]);

  const isDone = connector?.status === 'connected' && !!connector.lastSyncAt;
  const isSyncing = connector?.status === 'syncing';
  const isError = connector?.status === 'error' || connector?.status === 'sync_incomplete';

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">ממתין לסנכרון הראשוני מה-connector...</p>
      <div className="rounded-lg bg-gray-100 p-4 text-sm">
        {isSyncing && <p>מסנכרן... נסרקו {entitiesCount} רשומות עד כה</p>}
        {isDone && <p className="text-green-700">✓ הסנכרון הושלם! נסרקו {entitiesCount} רשומות.</p>}
        {isError && (
          <p className="text-red-700">
            הסנכרון נכשל או הופסק באמצע. הרץ שוב את ה-connector - הוא ימשיך מהנקודה שבה נעצר, לא יתחיל
            מחדש.
          </p>
        )}
        {!connector && <p>ממתין לחיבור ראשוני...</p>}
      </div>
      <button className="btn-primary" disabled={!isDone} onClick={() => onNext({ step: 4 })}>
        המשך
      </button>
      <button className="btn-secondary block" onClick={() => onNext({ step: 4 })}>
        דלג בינתיים (אפשר להשלים סנכרון מאוחר יותר)
      </button>
    </div>
  );
}

function StepDone({ draft, onFinish }: { draft: Draft; onFinish: () => void }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">ההקמה הושלמה! להתקנת התוסף אצל עובדים:</p>
      <div className="rounded-lg bg-gray-100 p-4">
        <p className="mb-1 text-xs text-gray-500">קוד החברה (API key)</p>
        <code className="block break-all rounded bg-gray-800 p-2 text-xs text-green-300">{draft.apiKey}</code>
        <button
          className="btn-secondary mt-2"
          onClick={() => {
            navigator.clipboard.writeText(draft.apiKey ?? '');
            setCopied(true);
          }}
        >
          {copied ? 'הועתק!' : 'העתק'}
        </button>
      </div>
      <ol className="list-inside list-decimal space-y-1 text-sm text-gray-700">
        <li>הוסף עובדים במסך "עובדים" - כל עובד יקבל קוד התקנה אישי</li>
        <li>כל עובד מתקין את תוסף הכרום ומזין את קוד ההתקנה שלו</li>
        <li>זהו - הודעות עם מידע רגיש יוסתרו אוטומטית לפני שליחה לכלי AI</li>
      </ol>
      <button className="btn-primary" onClick={onFinish}>
        לכניסה למערכת הניהול
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}
