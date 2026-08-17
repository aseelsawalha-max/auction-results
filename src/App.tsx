import { useState } from 'react';
import { DatasetProvider, useDataset } from './hooks/useDataset';
import { FiltersProvider } from './hooks/useFilters';
import { Overview } from './pages/Overview';
import { FacilityResults } from './pages/FacilityResults';
import { SystemStatus } from './pages/SystemStatus';
import './App.css';

type Tab = 'overview' | 'facility' | 'status';

function TopBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const { dataset } = useDataset();
  const lastUpload = dataset.uploads[0];

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__title">Auction Results Dashboard</span>
        <span className="topbar__subtitle">
          {lastUpload
            ? `Last updated ${new Date(lastUpload.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
            : 'No data uploaded yet'}
        </span>
      </div>
      <nav className="topbar__nav">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
        <button className={tab === 'facility' ? 'active' : ''} onClick={() => setTab('facility')}>Facility Results</button>
        <button className={tab === 'status' ? 'active' : ''} onClick={() => setTab('status')}>System Status</button>
      </nav>
    </header>
  );
}

function AppShell() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="app-shell">
      <TopBar tab={tab} setTab={setTab} />
      <main className="app-main">
        {tab === 'overview' && <Overview />}
        {tab === 'facility' && <FacilityResults />}
        {tab === 'status' && <SystemStatus />}
      </main>
    </div>
  );
}

function App() {
  return (
    <DatasetProvider>
      <FiltersProvider>
        <AppShell />
      </FiltersProvider>
    </DatasetProvider>
  );
}

export default App;
