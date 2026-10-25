import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './dashboard.css'
import Dashboard from './Dashboard.tsx'
import { lang } from './i18n'

if (lang() === 'en') document.title = 'Adresse · Luxury retail site selection in Paris'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
)
