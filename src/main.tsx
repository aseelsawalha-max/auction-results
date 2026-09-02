import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './hooks/useAuth.tsx'
import { DatasetProvider } from './hooks/useDataset.tsx'
import { FiltersProvider } from './hooks/useFilters.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <DatasetProvider>
          <FiltersProvider>
            <App />
          </FiltersProvider>
        </DatasetProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
