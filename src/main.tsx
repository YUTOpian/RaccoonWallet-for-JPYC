import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, CssBaseline } from '@mui/material'
import App from './App.tsx'
import { raccoonTheme } from './theme/raccoonTheme'
import { Storage } from './lib/storage'
import './i18n'

// localForage's driver (IndexedDB → WebSQL → localStorage fallback) must be configured
// before any Storage/WalletsHelper read happens. Previously this call didn't exist
// anywhere, so a browser/profile where IndexedDB throws at open time (a completely fresh
// browser profile, some privacy modes, file:// origins) never fell back to WebSQL/
// localStorage — the wallet-detection read in router.tsx's RootRedirect would reject
// silently, leaving RootRedirect stuck and never reaching /welcome.
Storage.setup();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={raccoonTheme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
)
