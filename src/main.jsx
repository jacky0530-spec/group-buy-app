import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './responsive.css'
import './mobile-sidebar-fix.css'
import './pending-report-modes.css'
import './batch-order-highlight.css'
import './report-tabs-highlight.css'
import './lib/enableNeonDualWrite.js'
import './lib/enableNeonHelperReads.js'
import './lib/enableNeonHelperAdminRead.js'
import './lib/enableNeonOrderRead.js'
import './lib/enableNeonPaymentRead.js'
import './lib/enableNeonInventoryReads.js'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
