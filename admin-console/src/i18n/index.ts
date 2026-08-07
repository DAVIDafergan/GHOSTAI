import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './locales/he.json';
import en from './locales/en.json';

export const LANG_STORAGE_KEY = 'piiShieldLang';
export type SupportedLang = 'he' | 'en';

function getInitialLang(): SupportedLang {
  const saved = localStorage.getItem(LANG_STORAGE_KEY);
  return saved === 'en' ? 'en' : 'he';
}

export function applyDirection(lang: SupportedLang): void {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
}

i18n.use(initReactI18next).init({
  resources: {
    he: { translation: he },
    en: { translation: en },
  },
  lng: getInitialLang(),
  fallbackLng: 'he',
  interpolation: { escapeValue: false },
});

applyDirection(getInitialLang());

i18n.on('languageChanged', (lng) => {
  localStorage.setItem(LANG_STORAGE_KEY, lng);
  applyDirection(lng === 'en' ? 'en' : 'he');
});

export default i18n;
