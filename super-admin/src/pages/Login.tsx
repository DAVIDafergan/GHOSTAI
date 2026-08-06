import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { useSession } from '../context/SessionContext';

export function Login() {
  const { login } = useSession();
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
      setError(
        err instanceof ApiError && err.status === 401
          ? 'שם משתמש או סיסמה שגויים.'
          : 'לא ניתן היה להתחבר. ודאו שכתובת השרת נכונה ושהשרת פעיל.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8" dir="rtl">
      <h1 className="mb-1 text-2xl font-bold text-indigo-700">Nistar - Super Admin</h1>
      <p className="mb-6 text-sm text-gray-500">
        גישה למפעיל המערכת בלבד - לא למנהלי חברות. שם המשתמש והסיסמה כאן הם חשבון המפעיל
        (SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD), לא apiKey של אף חברה.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">כתובת שרת ה-backend</span>
          <input className="input" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">שם משתמש</span>
          <input
            className="input"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">סיסמה</span>
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
          {loading ? 'מתחבר...' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}
