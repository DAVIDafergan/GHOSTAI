import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionProvider, useSession } from './context/SessionContext';
import { Layout } from './components/Layout';
import { Onboarding } from './pages/Onboarding';
import { Dashboard } from './pages/Dashboard';
import { Employees } from './pages/Employees';
import { EmployeeProfile } from './pages/EmployeeProfile';
import { Settings } from './pages/Settings';
import { SensitiveData } from './pages/SensitiveData';
import { AdminGuide } from './pages/AdminGuide';

function AppRoutes() {
  const { session } = useSession();

  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<Onboarding />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/employees/:id" element={<EmployeeProfile />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/sensitive-data" element={<SensitiveData />} />
        <Route path="/guide" element={<AdminGuide />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </SessionProvider>
  );
}
