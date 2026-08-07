import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { api, Company } from '../api/client';
import { useSession } from '../context/SessionContext';
import { ALL_ENTITY_TYPES } from '../entityTypes';
import { HelpTooltip } from '../components/HelpTooltip';

export function Settings() {
  const { session } = useSession();
  const { t } = useTranslation();
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

  if (!company) return <p className="text-gray-500">{t('common.loading')}</p>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="max-w-lg space-y-6"
    >
      <h1 className="flex items-center gap-2 text-xl font-bold">
        {t('settings.title')}
        <HelpTooltip topic="settings" />
      </h1>

      <div className="card">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">{t('settings.confidenceThreshold')}</h2>
        <input
          type="range"
          min={0}
          max={100}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-full"
        />
        <p className="text-sm text-gray-600">{t('settings.thresholdDescription', { threshold })}</p>
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('settings.entityTypesTitle')}</h2>
        <div className="space-y-2">
          {ALL_ENTITY_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={enabledTypes.includes(type)} onChange={() => toggleType(type)} />
              {t(`entityTypes.${type}`)}
            </label>
          ))}
        </div>
      </div>

      <button className="btn-primary" onClick={handleSave}>
        {t('settings.save')}
      </button>
      {saved && <p className="text-sm text-green-700">{t('settings.saved')}</p>}
    </motion.div>
  );
}
