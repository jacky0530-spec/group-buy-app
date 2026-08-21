import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './responsive.css'
import './mobile-sidebar-fix.css'
import './pending-report-modes.css'
import './batch-order-highlight.css'
import './report-tabs-highlight.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)