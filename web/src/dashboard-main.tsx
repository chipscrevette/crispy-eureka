import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './dashboard.css'
import Dashboard from './Dashboard.tsx'
import { lang } from './i18n'

if (lang() === 'en') document.title = 'Adresse · Dashboard'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
)
