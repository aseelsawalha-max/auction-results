import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useDataset } from './hooks/useDataset';
import { useAuth } from './hooks/useAuth';
import { Overview } from './pages/Overview';
import { FacilityResults } from './pages/FacilityResults';
import { AdminLogin } from './pages/AdminLogin';
import { AdminDashboard } from './pages/AdminDashboard';
import './App.css';

function formatLastUpdated(dataset: ReturnType<typeof useDataset>['dataset']): string {
  const lastUpload = dataset.uploads[0];
  if (!lastUpload) return 'No data uploaded yet';
  return `Last updated ${new Date(lastUpload.timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function PublicTopBar() {
  const { dataset } = useDataset();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__title">Auction Results Dashboard</span>
        <span className="topbar__subtitle">{formatLastUpdated(dataset)}</span>
      </div>
      <nav className="topbar__nav">
        <button className={location.pathname === '/' ? 'active' : ''} onClick={() => navigate('/')}>
          Overview
        </button>
        <button
          className={location.pathname.startsWith('/facility') ? 'active' : ''}
          onClick={() => navigate('/facility')}
        >
          Facility Results
        </button>
      </nav>
    </header>
  );
}

function PublicShell() {
  return (
    <div className="app-shell">
      <PublicTopBar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/facility" element={<FacilityResults />} />
        </Routes>
      </main>
    </div>
  );
}

function AdminShell() {
  const { loading, session, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__title">Auction Results Dashboard</span>
          <span className="topbar__subtitle">Admin</span>
        </div>
        <nav className="topbar__nav">
          <button onClick={() => navigate('/')}>View Read-Only Dashboard</button>
        </nav>
      </header>
      <main className="app-main">
        {loading && <div className="page">Loading…</div>}
        {!loading && !session && <AdminLogin />}
        {!loading && session && !isAdmin && (
          <div className="page">
            <h1>Not Authorized</h1>
            <p className="text-muted">
              You're signed in as {session.user.email}, but this account is not on the admin
              allowlist. Ask an existing administrator to add your user ID to the{' '}
              <code>admin_users</code> table.
            </p>
            <button type="button" className="button" onClick={() => signOut()}>
              Sign Out
            </button>
          </div>
        )}
        {!loading && session && isAdmin && <AdminDashboard />}
      </main>
    </div>
  );
}

function AppShell() {
  const { configured } = useAuth();

  if (!configured) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar__brand">
            <span className="topbar__title">Auction Results Dashboard</span>
          </div>
        </header>
        <main className="app-main">
          <div className="page">
            <h1>Setup Required</h1>
            <div className="banner banner--error">
              Supabase is not configured for this deployment. Set <code>VITE_SUPABASE_URL</code>{' '}
              and <code>VITE_SUPABASE_ANON_KEY</code> and reload — see README.md for exact steps.
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/admin/*" element={<AdminShell />} />
      <Route path="/*" element={<PublicShell />} />
    </Routes>
  );
}

function App() {
  return <AppShell />;
}

export default App;
