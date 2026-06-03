import { NavLink, Outlet } from 'react-router-dom'
import { ShoppingBag, Users, ShoppingCart, BarChart2, Home, Menu, X, UserCog } from 'lucide-react'
import { useState } from 'react'
import { UserMenu } from './AuthGuard'

const NAV = [
  { to: '/',          icon: Home,        label: '首頁',   end: true },
  { to: '/products',  icon: ShoppingBag, label: '商品管理' },
  { to: '/customers', icon: Users,       label: '客戶管理' },
  { to: '/orders',    icon: ShoppingCart,label: '訂單管理' },
  { to: '/reports',   icon: BarChart2,   label: '銷售報表' },
  { to: '/accounts',  icon: UserCog,     label: '帳號管理' },
]

export default function Layout() {
  const [sideOpen, setSideOpen] = useState(false)

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220,
        background: '#1e293b',
        display: 'flex', flexDirection: 'column',
        position: 'fixed', top: 0, left: 0, bottom: 0,
        zIndex: 100,
        transform: sideOpen || window.innerWidth >= 768 ? 'none' : 'translateX(-100%)',
        transition: 'transform 0.25s ease',
        boxShadow: '2px 0 20px rgba(0,0,0,.15)',
      }} className="no-print">
        {/* Logo */}
        <div style={{ padding: '22px 20px 18px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShoppingBag size={18} color="white" />
            </div>
            <div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 15, letterSpacing: '-.3px' }}>團購百貨</div>
              <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 11 }}>Order System</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSideOpen(false)}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px',
                borderRadius: 10,
                textDecoration: 'none',
                fontSize: 14, fontWeight: isActive ? 700 : 500,
                color: isActive ? '#fff' : 'rgba(255,255,255,.55)',
                background: isActive ? 'rgba(99,102,241,.35)' : 'transparent',
                transition: 'all .15s',
              })}
            >
              {({ isActive }) => (
                <>
                  <Icon size={16} />
                  {label}
                  {isActive && <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: 'var(--indigo)' }} />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: '12px 10px', borderTop: '1px solid rgba(255,255,255,.06)' }}>
          <UserMenu />
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.2)', fontSize: 10, marginTop: 8 }}>
            © 2025 團購百貨管理系統
          </div>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {sideOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 99 }}
          onClick={() => setSideOpen(false)}
        />
      )}

      {/* Main */}
      <div style={{ marginLeft: 220, flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar (mobile only) */}
        <header style={{ display: 'none', background: '#1e293b', padding: '12px 16px', alignItems: 'center', gap: 12 }} className="mobile-header no-print">
          <button onClick={() => setSideOpen(p => !p)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
            {sideOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <span style={{ color: '#fff', fontWeight: 700 }}>團購百貨</span>
        </header>

        <main style={{ flex: 1, padding: '24px', minWidth: 0 }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
