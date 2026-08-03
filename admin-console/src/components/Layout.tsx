import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useSession } from '../context/SessionContext';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-lg px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'
  }`;

export function Layout({ children }: { children: ReactNode }) {
  const { logout } = useSession();

  return (
    <div className="flex min-h-screen bg-gray-50" dir="rtl">
      <aside className="w-56 shrink-0 border-l border-gray-200 bg-white p-4">
        <h1 className="mb-6 text-lg font-bold text-indigo-700">PII Shield</h1>
        <nav className="space-y-1">
          <NavLink to="/" end className={navLinkClass}>
            לוח בקרה
          </NavLink>
          <NavLink to="/employees" className={navLinkClass}>
            עובדים
          </NavLink>
          <NavLink to="/settings" className={navLinkClass}>
            הגדרות רגישות
          </NavLink>
        </nav>
        <button
          onClick={logout}
          className="mt-8 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
        >
          התנתקות
        </button>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
