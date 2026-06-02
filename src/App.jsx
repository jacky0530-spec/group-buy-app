import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ToastProvider } from './components/UI'
import Layout from './components/Layout'
import Home from './pages/Home'
import Products from './pages/Products'
import Customers from './pages/Customers'
import Orders from './pages/Orders'
import Reports from './pages/Reports'

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="products" element={<Products />} />
            <Route path="customers" element={<Customers />} />
            <Route path="orders" element={<Orders />} />
            <Route path="reports" element={<Reports />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}
