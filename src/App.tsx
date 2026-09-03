import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useDataset } from './hooks/useDataset';
import { useAuth } from './hooks/useAuth';
import { Overview } from './pages/Overview';
import { FacilityResults } from './pages/FacilityResults';
import { AdminLogin } from './pages/AdminLogin';
import { AdminDashboard } from './pages/AdminDashboard';
import { DashboardLogin } from './pages/DashboardLogin';
import { CreatePasswordForm } from './components/CreatePasswordForm';
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
  const { session, signOut } = useAuth();
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
      <div className="topbar__session">
        {session && <span className="text-muted">{session.user.email}</span>}
        <button type="button" className="button" onClick={() => signOut()}>
          Sign Out
        </button>
      </div>
    </header>
  );
}

function PublicShell() {
  const { loading, session } = useAuth();

  if (loading) {
    return (
      <div className="app-shell">
        <main className="app-main">
          <div className="page">Loading…</div>
        </main>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="app-shell">
        <main className="app-main">
          <DashboardLogin />
        </main>
      </div>
    );
  }

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

function BrandShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__title">Auction Results Dashboard</span>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}

function AppShell() {
  const { configured, loading, needsPasswordSetup, linkInvalid } = useAuth();

  if (!configured) {
    return (
      <BrandShell>
        <div className="page">
          <h1>Setup Required</h1>
          <div className="banner banner--error">
            Supabase is not configured for this deployment. Set <code>VITE_SUPABASE_URL</code>{' '}
            and <code>VITE_SUPABASE_ANON_KEY</code> and reload — see README.md for exact steps.
          </div>
        </div>
      </BrandShell>
    );
  }

  if (loading) {
    return (
      <BrandShell>
        <div className="page">Loading…</div>
      </BrandShell>
    );
  }

  // Gate ahead of the normal routes: an invited user must set a password
  // before reaching the read-only dashboard or the admin area, regardless
  // of which URL the invite/redirect landed them on.
  if (needsPasswordSetup) {
    return (
      <BrandShell>
        <CreatePasswordForm />
      </BrandShell>
    );
  }

  if (linkInvalid) {
    return (
      <BrandShell>
        <div className="page">
          <h1>Link Expired</h1>
          <div className="banner banner--error">
            This invitation or password reset link is invalid or has already been used. Ask an
            administrator to send a new invitation.
          </div>
        </div>
      </BrandShell>
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
