import { useEffect, useState, FormEvent } from 'react';
import { getConfig, setConfig, ExtensionConfig } from '../shared/config';

export function Popup() {
  const [backendUrl, setBackendUrl] = useState('');
  const [extensionKey, setExtensionKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    getConfig().then((config) => {
      if (config) {
        setBackendUrl(config.backendUrl);
        setExtensionKey(config.extensionKey);
      }
    });
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setStatus('checking');
    const config: ExtensionConfig = { backendUrl, extensionKey };
    try {
      const res = await fetch(`${backendUrl}/employees/me`, {
        headers: { 'x-extension-key': extensionKey },
      });
      if (!res.ok) throw new Error(String(res.status));
      await setConfig(config);
      setStatus('ok');
      setStatusMessage('מחובר בהצלחה');
    } catch {
      setStatus('error');
      setStatusMessage('לא ניתן להתחבר - בדוק את כתובת השרת ומפתח ההתקנה');
    }
  }

  return (
    <div style={{ width: 280, padding: 16, fontFamily: 'system-ui, sans-serif', direction: 'rtl' }}>
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>PII Shield</h2>
      <form onSubmit={handleSave}>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>כתובת שרת</label>
        <input
          value={backendUrl}
          onChange={(e) => setBackendUrl(e.target.value)}
          placeholder="https://backend.example.com"
          style={{ width: '100%', marginBottom: 8, boxSizing: 'border-box' }}
        />
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>קוד התקנה (extensionKey)</label>
        <input
          value={extensionKey}
          onChange={(e) => setExtensionKey(e.target.value)}
          style={{ width: '100%', marginBottom: 8, boxSizing: 'border-box' }}
        />
        <button type="submit" style={{ width: '100%' }} disabled={status === 'checking'}>
          {status === 'checking' ? 'בודק...' : 'שמור והתחבר'}
        </button>
      </form>
      {statusMessage && (
        <p style={{ fontSize: 12, marginTop: 8, color: status === 'ok' ? 'green' : 'crimson' }}>{statusMessage}</p>
      )}
    </div>
  );
}
