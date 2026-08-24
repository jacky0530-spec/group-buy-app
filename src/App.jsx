import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from './components/UI'
import { AuthProvider, AuthGuard, RoleGuard, useAuth } from './components/AuthGuard'
import Layout from './components/Layout'
import Login from './pages/Login'
import Home from './pages/Home'
import Products from './pages/Products'
import Customers from './pages/Customers'
import Orders from './pages/Orders'
import Reports from './pages/Reports'
import PendingProductReport from './pages/PendingProductReport'
import Expenses from './pages/Expenses'
import SupplierPayments from './pages/SupplierPayments'
import Accounts from './pages/Accounts'
import HelperPortal from './pages/HelperPortal'
import HelperEntries from './pages/HelperEntries'

function LandingRedirect(){ const { role } = useAuth(); return <Navigate to={role === 'helper' ? '/helper' : '/'} replace /> }

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<AuthGuard />}>
              <Route element={<RoleGuard roles={['owner','staff']} />}>
                <Route path="/" element={<Layout />}>
                  <Route index element={<Home />} />
                  <Route path="products" element={<Products />} />
                  <Route path="customers" element={<Customers />} />
                  <Route path="orders" element={<Orders />} />
                  <Route path="reports" element={<Reports />} />
                  <Route path="pending-report" element={<PendingProductReport />} />
                  <Route path="expenses" element={<Expenses />} />
                  <Route path="supplier-payments" element={<SupplierPayments />} />
                  <Route path="helper-entries" element={<HelperEntries />} />
                  <Route path="accounts" element={<Accounts />} />
                </Route>
              </Route>
              <Route element={<RoleGuard roles={['helper']} />}>
                <Route path="/helper" element={<HelperPortal />} />
              </Route>
              <Route path="/go" element={<LandingRedirect />} />
            </Route>
            <Route path="*" element={<Navigate to="/go" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  )
}
