import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Users, Database, Settings as SettingsIcon, BookOpen, LogOut } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { HealthIndicator } from './HealthIndicator';
import { LanguageToggle } from './LanguageToggle';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
    isActive ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'
  }`;

export function Layout({ children }: { children: ReactNode }) {
  const { logout } = useSession();
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="flex w-60 shrink-0 flex-col border-e border-gray-200 bg-white p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-bold text-indigo-700">{t('common.appName')}</h1>
          <LanguageToggle />
        </div>
        <HealthIndicator />
        <nav className="space-y-1">
          <NavLink to="/" end className={navLinkClass}>
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            {t('layout.nav.dashboard')}
          </NavLink>
          <NavLink to="/employees" className={navLinkClass}>
            <Users className="h-4 w-4 shrink-0" />
            {t('layout.nav.employees')}
          </NavLink>
          <NavLink to="/sensitive-data" className={navLinkClass}>
            <Database className="h-4 w-4 shrink-0" />
            {t('layout.nav.sensitiveData')}
          </NavLink>
          <NavLink to="/settings" className={navLinkClass}>
            <SettingsIcon className="h-4 w-4 shrink-0" />
            {t('layout.nav.settings')}
          </NavLink>
          <NavLink to="/guide" className={navLinkClass}>
            <BookOpen className="h-4 w-4 shrink-0" />
            {t('layout.nav.guide')}
          </NavLink>
        </nav>
        <button
          onClick={logout}
          className="mt-auto flex w-full items-center gap-2.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 transition-colors duration-150 hover:bg-gray-100"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {t('layout.logout')}
        </button>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
