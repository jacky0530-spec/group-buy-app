import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from './components/UI'
import { AuthProvider, AuthGuard } from './components/AuthGuard'
import Layout from './components/Layout'
import Login from './pages/Login'
import Home from './pages/Home'
import Products from './pages/Products'
import Customers from './pages/Customers'
import Orders from './pages/Orders'
import Reports from './pages/Reports'
import Accounts from './pages/Accounts'

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<AuthGuard />}>
              <Route path="/" element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="products"  element={<Products />} />
                <Route path="customers" element={<Customers />} />
                <Route path="orders"    element={<Orders />} />
                <Route path="reports"   element={<Reports />} />
                <Route path="accounts"  element={<Accounts />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  )
}
