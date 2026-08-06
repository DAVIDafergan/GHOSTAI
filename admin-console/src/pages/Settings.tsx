import { useEffect, useState } from 'react';
import { api, Company } from '../api/client';
import { useSession } from '../context/SessionContext';
import { ENTITY_TYPE_LABELS, ALL_ENTITY_TYPES } from '../entityTypes';

export function Settings() {
  const { session } = useSession();
  const [company, setCompany] = useState<Company | null>(null);
  const [threshold, setThreshold] = useState(50);
  const [enabledTypes, setEnabledTypes] = useState<string[]>(ALL_ENTITY_TYPES);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!session) return;
    api.getCompany(session).then((c) => {
      setCompany(c);
      setThreshold(c.confidenceThreshold);
      setEnabledTypes(c.enabledEntityTypes);
    });
  }, [session]);

  async function handleSave() {
    if (!session) return;
    const updated = await api.updateSettings(session, { confidenceThreshold: threshold, enabledEntityTypes: enabledTypes });
    setCompany(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function toggleType(type: string) {
    setEnabledTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

  if (!company) return <p className="text-gray-500">טוען...</p>;

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-bold">הגדרות רגישות</h1>

      <div className="card">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">סף רגישות (confidence threshold)</h2>
        <input
          type="range"
          min={0}
          max={100}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-full"
        />
        <p className="text-sm text-gray-600">
          בסף הנוכחי ({threshold}), ישויות עם רמת ודאות נמוכה מ-{threshold}% לא ייחסמו.
        </p>
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">סוגי מידע פעילים</h2>
        <div className="space-y-2">
          {ALL_ENTITY_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={enabledTypes.includes(type)} onChange={() => toggleType(type)} />
              {ENTITY_TYPE_LABELS[type]}
            </label>
          ))}
        </div>
      </div>

      <button className="btn-primary" onClick={handleSave}>
        שמור הגדרות
      </button>
      {saved && <p className="text-sm text-green-700">נשמר בהצלחה</p>}
    </div>
  );
}
