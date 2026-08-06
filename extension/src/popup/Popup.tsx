import { useSettingsForm } from '../shared/useSettingsForm';

export function Popup() {
  const { backendUrl, setBackendUrl, extensionKey, setExtensionKey, status, statusMessage, handleSave } =
    useSettingsForm();

  return (
    <div style={{ width: 280, padding: 16, fontFamily: 'system-ui, sans-serif', direction: 'rtl' }}>
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Nistar</h2>
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
      <button
        type="button"
        onClick={() => chrome.runtime.openOptionsPage()}
        style={{
          width: '100%',
          marginTop: 8,
          background: 'none',
          border: 'none',
          color: '#4f46e5',
          fontSize: 12,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        פתח כעמוד מלא (נוח יותר להדבקת ערכים - החלון הזה נסגר במעבר בין טאבים)
      </button>
    </div>
  );
}
