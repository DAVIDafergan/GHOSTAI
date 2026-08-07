import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import { useSession } from '../context/SessionContext';
import { LanguageToggle } from '../components/LanguageToggle';

export function Login() {
  const { login } = useSession();
  const { t } = useTranslation();
  const [backendUrl, setBackendUrl] = useState('http://localhost:3000');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const session = { backendUrl: backendUrl.trim().replace(/\/$/, ''), username, password };
    try {
      await api.verifyAndListCompanies(session);
      login(session);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t('login.errorAuth') : t('login.errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-indigo-700">{t('common.appName')}</h1>
        <LanguageToggle />
      </div>
      <p className="mb-6 text-sm text-gray-500">{t('login.subtitle')}</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">{t('login.backendUrl')}</span>
          <input className="input" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">{t('login.username')}</span>
          <input
            className="input"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">{t('login.password')}</span>
          <input
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? t('login.connecting') : t('login.submit')}
        </button>
      </form>
    </div>
  );
}
