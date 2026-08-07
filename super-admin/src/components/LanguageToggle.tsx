import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

export function LanguageToggle({ className = '' }: { className?: string }) {
  const { i18n } = useTranslation();
  const next = i18n.language === 'he' ? 'en' : 'he';

  return (
    <button
      type="button"
      onClick={() => i18n.changeLanguage(next)}
      className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 ${className}`}
      title={next === 'en' ? 'Switch to English' : 'עברית'}
    >
      <Languages className="h-3.5 w-3.5" />
      {next === 'en' ? 'EN' : 'עברית'}
    </button>
  );
}
