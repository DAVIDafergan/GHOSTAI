import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, ConnectorSummary } from '../api/client';
import { useSession } from '../context/SessionContext';
import { LanguageToggle } from '../components/LanguageToggle';

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

export function Onboarding() {
  // Persisted across reloads so closing the browser mid-wizard resumes
  // instead of restarting (and, critically, doesn't create a second
  // company on step 1 - spec 6.5's onboarding edge case).
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const { login } = useSession();
  const { t } = useTranslation();

  const update = (patch: Partial<Draft>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      saveDraft(next);
      return next;
    });
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center p-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-indigo-700">{t('onboarding.title')}</h1>
        <LanguageToggle />
      </div>
      <p className="mb-8 text-sm text-gray-500">{t('onboarding.stepOf', { step: draft.step })}</p>
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
  const { t } = useTranslation();
  const [backendUrl, setBackendUrl] = useState(draft.backendUrl || 'http://localhost:3000');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api.createCompany(backendUrl, adminUsername, adminPassword, name, adminEmail || undefined);
      onNext({ step: 2, backendUrl, companyId: result.id, apiKey: result.apiKey });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401 ? t('onboarding.step1.errorAuth') : t('onboarding.step1.errorGeneric'),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="rounded-lg bg-indigo-50 p-3 text-xs text-indigo-800">{t('onboarding.step1.operatorNotice')}</p>
      <Field label={t('onboarding.step1.companyName')} help={t('onboarding.step1.companyNameHelp')}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label={t('onboarding.step1.username')} help={t('onboarding.step1.usernameHelp')}>
        <input
          className="input"
          autoComplete="username"
          value={adminUsername}
          onChange={(e) => setAdminUsername(e.target.value)}
          required
        />
      </Field>
      <Field label={t('onboarding.step1.password')}>
        <input
          type="password"
          className="input"
          autoComplete="current-password"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          required
        />
      </Field>
      <Field label={t('onboarding.step1.contactEmail')} help={t('onboarding.step1.contactEmailHelp')}>
        <input
          type="email"
          className="input"
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
        />
      </Field>

      <details className="rounded-lg border border-gray-200 p-3 text-sm">
        <summary className="cursor-pointer select-none font-medium text-gray-600">{t('onboarding.step1.advanced')}</summary>
        <div className="mt-3">
          <Field
            label={t('onboarding.step1.backendUrl')}
            help={t('onboarding.step1.backendUrlHelp')}
            howToFind={t('onboarding.step1.backendUrlHowToFind')}
          >
            <input
              className="input"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              required
            />
          </Field>
        </div>
      </details>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? t('onboarding.step1.creating') : t('common.continue')}
      </button>
    </form>
  );
}

function StepConnectSource({ draft, onNext }: { draft: Draft; onNext: (patch: Partial<Draft>) => void }) {
  const { t } = useTranslation();
  const SOURCE_TYPES: { value: string; label: string; available: boolean }[] = [
    { value: 'postgres', label: 'PostgreSQL', available: true },
    { value: 'csv', label: t('onboarding.step2.sourceCsv'), available: true },
    { value: 'salesforce', label: t('onboarding.step2.sourceSalesforce'), available: false },
    { value: 'generic_api', label: t('onboarding.step2.sourceGenericApi'), available: false },
  ];
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

  const exampleConfig =
    sourceType === 'csv'
      ? `{
  "backendUrl": "${draft.backendUrl}",
  "apiKey": "<${t('onboarding.step2.apiKeyTitle')}>",
  "source": {
    "type": "csv",
    "filePath": "/path/to/customers.csv",
    "fieldMappings": [
      { "column": "full_name", "entityType": "name" },
      { "column": "id_number", "entityType": "id_number" }
    ]
  }
}`
      : `{
  "backendUrl": "${draft.backendUrl}",
  "apiKey": "<${t('onboarding.step2.apiKeyTitle')}>",
  "source": {
    "type": "postgres",
    "connectionString": "postgresql://user:password@host:5432/dbname",
    "table": "customers",
    "fieldMappings": [
      { "column": "full_name", "entityType": "name" },
      { "column": "id_number", "entityType": "id_number" }
    ]
  }
}`;

  return (
    <div className="space-y-4">
      <Field label={t('onboarding.step2.sourceType')} help={t('onboarding.step2.sourceTypeHelp')}>
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
          {t('onboarding.step2.createConnector')}
        </button>
      )}

      {connectorId && (
        <div className="space-y-3 rounded-lg bg-gray-100 p-4 text-sm">
          <p>{t('onboarding.step2.connectorIntro')}</p>

          <div>
            <p className="mb-1 font-medium text-gray-700">{t('onboarding.step2.apiKeyTitle')}</p>
            <p className="mb-1 text-xs text-gray-500">{t('onboarding.step2.apiKeyHelp')}</p>
            <code className="block break-all rounded bg-gray-800 p-2 text-xs text-green-300">{draft.apiKey}</code>
          </div>

          <div>
            <p className="mb-1 font-medium text-gray-700">
              {t('onboarding.step2.configTitle')} <code>connector.config.json</code>
            </p>
            <p className="mb-1 text-xs text-gray-500">{t('onboarding.step2.configExample')}</p>
            <pre className="overflow-x-auto rounded bg-gray-800 p-2 text-xs text-green-300" dir="ltr">
              {exampleConfig}
            </pre>
            <HowToFind label={t('onboarding.step2.credentialsHowToFindLabel')}>
              {t('onboarding.step2.credentialsHowToFind')}
            </HowToFind>
          </div>

          <div>
            <p className="mb-1 font-medium text-gray-700">{t('onboarding.step2.runTitle')}</p>
            <code className="block break-all rounded bg-gray-800 p-2 text-xs text-green-300">{dockerCommand}</code>
          </div>

          <button className="btn-secondary" onClick={handleCheckConnection} disabled={checking}>
            {checking ? t('onboarding.step2.checking') : t('onboarding.step2.checkConnection')}
          </button>
          {checkResult === 'ok' && <p className="text-green-700">{t('onboarding.step2.connectedOk')}</p>}
          {checkResult === 'not-yet' && <p className="text-amber-700">{t('onboarding.step2.notYet')}</p>}
        </div>
      )}

      <button
        className="btn-primary"
        disabled={!connectorId}
        onClick={() => onNext({ step: 3, connectorId, sourceType })}
      >
        {t('common.continue')}
      </button>
    </div>
  );
}

function StepInitialSync({ draft, onNext }: { draft: Draft; onNext: (patch: Partial<Draft>) => void }) {
  const { t } = useTranslation();
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
      <p className="text-sm text-gray-600">{t('onboarding.step3.waiting')}</p>
      <div className="rounded-lg bg-gray-100 p-4 text-sm">
        {isSyncing && <p>{t('onboarding.step3.syncing', { count: entitiesCount })}</p>}
        {isDone && <p className="text-green-700">{t('onboarding.step3.done', { count: entitiesCount })}</p>}
        {isError && <p className="text-red-700">{t('onboarding.step3.error')}</p>}
        {!connector && <p>{t('onboarding.step3.waitingInitial')}</p>}
      </div>
      <button className="btn-primary" disabled={!isDone} onClick={() => onNext({ step: 4 })}>
        {t('common.continue')}
      </button>
      <button className="btn-secondary block" onClick={() => onNext({ step: 4 })}>
        {t('onboarding.step3.skip')}
      </button>
    </div>
  );
}

function StepDone({ draft, onFinish }: { draft: Draft; onFinish: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">{t('onboarding.step4.complete')}</p>
      <div className="rounded-lg bg-gray-100 p-4">
        <p className="mb-1 text-xs text-gray-500">{t('onboarding.step4.apiKeyLabel')}</p>
        <code className="block break-all rounded bg-gray-800 p-2 text-xs text-green-300">{draft.apiKey}</code>
        <button
          className="btn-secondary mt-2"
          onClick={() => {
            navigator.clipboard.writeText(draft.apiKey ?? '');
            setCopied(true);
          }}
        >
          {copied ? t('common.copied') : t('common.copy')}
        </button>
      </div>
      <ol className="list-inside list-decimal space-y-1 text-sm text-gray-700">
        <li>{t('onboarding.step4.step1')}</li>
        <li>{t('onboarding.step4.step2')}</li>
        <li>{t('onboarding.step4.step3')}</li>
      </ol>
      <button className="btn-primary" onClick={onFinish}>
        {t('onboarding.step4.enter')}
      </button>
    </div>
  );
}

function Field({
  label,
  help,
  howToFind,
  children,
}: {
  label: string;
  help?: string;
  howToFind?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
      {help && <p className="mt-1 text-xs text-gray-500">{help}</p>}
      {howToFind && <HowToFind label={t('onboarding.howToFind')}>{howToFind}</HowToFind>}
    </label>
  );
}

function HowToFind({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer select-none text-xs font-medium text-indigo-600">{label}</summary>
      <p className="mt-1 text-xs text-gray-500">{children}</p>
    </details>
  );
}
