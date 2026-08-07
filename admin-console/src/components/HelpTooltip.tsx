import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle, X } from 'lucide-react';

/** Small "?" icon that opens a short explanation panel for the current tab. */
export function HelpTooltip({ topic }: { topic: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('common.help')}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute start-0 top-7 z-20 w-72 rounded-xl border border-gray-200 bg-white p-4 text-start shadow-lg">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-800">{t(`help.${topic}.title`)}</h3>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs leading-relaxed text-gray-600">{t(`help.${topic}.body`)}</p>
        </div>
      )}
    </span>
  );
}
