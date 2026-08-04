import { useSettingsForm } from '../shared/useSettingsForm';

export function Options() {
  const { backendUrl, setBackendUrl, extensionKey, setExtensionKey, status, statusMessage, handleSave } =
    useSettingsForm();

  return (
    <div
      style={{
        maxWidth: 480,
        margin: '48px auto',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        direction: 'rtl',
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>הגדרות PII Shield</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 20 }}>
        עמוד זה, בניגוד לחלונית הקופצת, נשאר פתוח במעבר בין טאבים - נוח יותר להדבקת כתובת שרת או קוד
        התקנה ארוכים.
      </p>
      <form onSubmit={handleSave}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>כתובת שרת</label>
        <input
          value={backendUrl}
          onChange={(e) => setBackendUrl(e.target.value)}
          placeholder="https://backend.example.com"
          style={{
            width: '100%',
            padding: '8px 10px',
            marginBottom: 4,
            boxSizing: 'border-box',
            fontSize: 14,
            border: '1px solid #d1d5db',
            borderRadius: 6,
          }}
        />
        <p style={{ fontSize: 12, color: '#888', marginTop: 0, marginBottom: 16 }}>
          כתובת שרת ה-PII Shield של החברה שלכם. קיבלתם אותה ממנהל המערכת אצלכם יחד עם קוד ההתקנה.
        </p>

        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
          קוד התקנה (extensionKey)
        </label>
        <input
          value={extensionKey}
          onChange={(e) => setExtensionKey(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 10px',
            marginBottom: 4,
            boxSizing: 'border-box',
            fontSize: 14,
            border: '1px solid #d1d5db',
            borderRadius: 6,
          }}
        />
        <p style={{ fontSize: 12, color: '#888', marginTop: 0, marginBottom: 16 }}>
          קוד אישי שקיבלתם ממנהל המערכת אצלכם כשנוספתם כעובד. מוצג פעם אחת בלבד למנהל - אם איבדתם אותו,
          בקשו מהמנהל להנפיק לכם קוד חדש (במסך "עובדים").
        </p>

        <button
          type="submit"
          disabled={status === 'checking'}
          style={{
            width: '100%',
            padding: '10px 0',
            fontSize: 14,
            fontWeight: 500,
            color: 'white',
            background: '#4f46e5',
            border: 'none',
            borderRadius: 6,
            cursor: status === 'checking' ? 'default' : 'pointer',
            opacity: status === 'checking' ? 0.6 : 1,
          }}
        >
          {status === 'checking' ? 'בודק...' : 'שמור והתחבר'}
        </button>
      </form>
      {statusMessage && (
        <p style={{ fontSize: 13, marginTop: 12, color: status === 'ok' ? 'green' : 'crimson' }}>
          {statusMessage}
        </p>
      )}
    </div>
  );
}
