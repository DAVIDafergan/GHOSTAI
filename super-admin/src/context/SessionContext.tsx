import { createContext, useContext, useState, ReactNode } from 'react';
import { SuperAdminSession, loadSession, saveSession, clearSession } from '../api/client';

interface SessionContextValue {
  session: SuperAdminSession | null;
  login: (session: SuperAdminSession) => void;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SuperAdminSession | null>(() => loadSession());

  const login = (newSession: SuperAdminSession) => {
    saveSession(newSession);
    setSession(newSession);
  };
  const logout = () => {
    clearSession();
    setSession(null);
  };

  return <SessionContext.Provider value={{ session, login, logout }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
