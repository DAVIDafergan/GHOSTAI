import { useEffect, useState, FormEvent } from 'react';
import { getConfig, setConfig, ExtensionConfig } from './config';

export function useSettingsForm() {
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

  return { backendUrl, setBackendUrl, extensionKey, setExtensionKey, status, statusMessage, handleSave };
}
