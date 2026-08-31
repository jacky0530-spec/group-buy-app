import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from './components/UI'
import { AuthProvider, AuthGuard, RoleGuard, useAuth } from './components/AuthGuard'
import CustomerSearchNotes from './components/CustomerSearchNotes'
import OrderArrivalResetPatch from './components/OrderArrivalResetPatch'
import StockAssetPanel from './components/StockAssetPanel'
import StockValueTopCard from './components/StockValueTopCard'
import FinanceCostWarning from './components/FinanceCostWarning'
import Layout from './components/Layout'
import Login from './pages/Login'
import Home from './pages/Home'
import Products from './pages/Products'
import Customers from './pages/Customers'
import Orders from './pages/OrdersCorrectable'
import OrderCleanup from './pages/OrderCleanup'
import ExcelOrderImport from './pages/ExcelOrderImport'
import Reports from './pages/ReportsSql'
import PendingProductReport from './pages/PendingProductReportFiltered'
import StockInventory from './pages/StockInventory'
import Expenses from './pages/Expenses'
import SupplierPayments from './pages/SupplierPayments'
import IncomingBatches from './pages/IncomingBatches'
import BackupMigrationCenter from './pages/BackupMigrationCenter'
import Accounts from './pages/Accounts'
import HelperPortal from './pages/HelperPortalV4'
import HelperEntries from './pages/HelperEntries'

function LandingRedirect(){ const { role } = useAuth(); return <Navigate to={role === 'helper' ? '/helper' : '/'} replace /> }

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <CustomerSearchNotes />
          <OrderArrivalResetPatch />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<AuthGuard />}>
              <Route element={<RoleGuard roles={['owner','staff']} />}>
                <Route path="/" element={<Layout />}>
                  <Route index element={<Home />} />
                  <Route path="products" element={<Products />} />
                  <Route path="customers" element={<Customers />} />
                  <Route path="orders" element={<Orders />} />
                  <Route element={<RoleGuard roles={['owner']} />}>
                    <Route path="order-cleanup" element={<OrderCleanup />} />
                    <Route path="backup-center" element={<BackupMigrationCenter />} />
                  </Route>
                  <Route path="order-import" element={<ExcelOrderImport />} />
                  <Route path="reports" element={<><FinanceCostWarning/><Reports/><StockValueTopCard/><StockAssetPanel/></>} />
                  <Route path="pending-report" element={<PendingProductReport />} />
                  <Route path="incoming" element={<IncomingBatches />} />
                  <Route path="stock" element={<StockInventory />} />
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