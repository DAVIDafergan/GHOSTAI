import { SessionProvider, useSession } from './context/SessionContext';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';

function Root() {
  const { session } = useSession();
  return session ? <Dashboard /> : <Login />;
}

export default function App() {
  return (
    <SessionProvider>
      <Root />
    </SessionProvider>
  );
}
