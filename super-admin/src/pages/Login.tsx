import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { useSession } from '../context/SessionContext';

export function Login() {
  const { login } = useSession();
  const [backendUrl, setBackendUrl] = useState('http://localhost:3000');
  const [adminSecret, setAdminSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const session = { backendUrl: backendUrl.trim().replace(/\/$/, ''), adminSecret };
    try {
      await api.verifyAndListCompanies(session);
      login(session);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'ADMIN_BOOTSTRAP_SECRET שגוי.'
          : 'לא ניתן היה להתחבר. ודאו שכתובת השרת נכונה ושהשרת פעיל.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8" dir="rtl">
      <h1 className="mb-1 text-2xl font-bold text-indigo-700">PII Shield - Super Admin</h1>
      <p className="mb-6 text-sm text-gray-500">
        גישה למפעיל המערכת בלבד - לא למנהלי חברות. הסוד כאן הוא ADMIN_BOOTSTRAP_SECRET, לא apiKey של אף חברה.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">כתובת שרת ה-backend</span>
          <input className="input" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">ADMIN_BOOTSTRAP_SECRET</span>
          <input
            type="password"
            className="input"
            value={adminSecret}
            onChange={(e) => setAdminSecret(e.target.value)}
            required
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'מתחבר...' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}
