import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ShoppingBag, Users, ShoppingCart, BarChart2, Home, Menu, X, UserCog, ClipboardList, ReceiptText, CreditCard, ClipboardCheck, FileSpreadsheet, Warehouse, Trash2, Truck, DatabaseBackup } from 'lucide-react'
import { useEffect, useState } from 'react'
import { UserMenu, useAuth } from './AuthGuard'
import IncomingArchivePanel from './IncomingArchivePanel'

// 第22版：即將到貨頁新增已完成批次商品的單筆／批次封存功能。
const APP_VERSION = '第22版｜2026/08/30'
const BACKUP_OWNER_EMAIL='jacky0530@gmail.com'

const NAV = [
  { to: '/', icon: Home, label: '首頁', end: true },
  { to: '/products', icon: ShoppingBag, label: '商品管理' },
  { to: '/customers', icon: Users, label: '客戶管理' },
  { to: '/orders', icon: ShoppingCart, label: '訂單管理' },
  { to: '/order-cleanup', icon: Trash2, label: '歷史訂單清理', ownerOnly:true },
  { to: '/order-import', icon: FileSpreadsheet, label: 'Excel匯入訂單' },
  { to: '/reports', icon: BarChart2, label: '銷售報表' },
  { to: '/pending-report', icon: ClipboardList, label: '未出貨報表' },
  { to: '/incoming', icon: Truck, label: '即將到貨' },
  { to: '/stock', icon: Warehouse, label: '現貨庫存' },
  { to: '/expenses', icon: ReceiptText, label: '其他費用' },
  { to: '/supplier-payments', icon: CreditCard, label: '供應商付款' },
  { to: '/helper-entries', icon: ClipboardCheck, label: '小幫手登記' },
  { to: '/accounts', icon: UserCog, label: '帳號管理' },
  { to: '/backup-center', icon: DatabaseBackup, label: '系統備份／移轉', backupOwnerOnly:true },
]

export default function Layout() {
  const [sideOpen, setSideOpen] = useState(false)
  const location = useLocation()
  const { role,user } = useAuth()
  const email=String(user?.email||'').toLowerCase()
  const visibleNav = NAV.filter(item => (!item.ownerOnly || role === 'owner') && (!item.backupOwnerOnly || (role==='owner'&&email===BACKUP_OWNER_EMAIL)))

  useEffect(() => { setSideOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!sideOpen || !window.matchMedia('(max-width: 1023px)').matches) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [sideOpen])

  return <div className="app-layout">
    <aside className={`app-sidebar no-print ${sideOpen ? 'is-open' : ''}`} aria-label="主選單">
      <div className="sidebar-brand"><div className="sidebar-brand-row"><div className="sidebar-logo"><ShoppingBag size={18} color="white" /></div><div><div className="sidebar-title">團購百貨</div><div className="sidebar-subtitle">Order System · {APP_VERSION}</div></div></div></div>
      <nav className="sidebar-nav">{visibleNav.map(({to,icon:Icon,label,end})=><NavLink key={to} to={to} end={end} className={({isActive})=>`sidebar-nav-link ${isActive?'active':''}`}>{({isActive})=><><Icon size={17}/><span>{label}</span>{isActive&&<span className="sidebar-active-dot"/>}</>}</NavLink>)}</nav>
      <div className="sidebar-footer"><UserMenu/><div className="sidebar-copyright">© 2025 團購百貨管理系統 · {APP_VERSION}</div></div>
    </aside>
    {sideOpen&&<button type="button" className="sidebar-backdrop no-print" aria-label="關閉選單" onClick={()=>setSideOpen(false)}/>} 
    <div id="main-content" className="app-shell-content print-content">
      <header className="mobile-header no-print"><button type="button" className="mobile-menu-button" onClick={()=>setSideOpen(p=>!p)} aria-label={sideOpen?'關閉選單':'開啟選單'} aria-expanded={sideOpen}>{sideOpen?<X size={22}/>:<Menu size={22}/>}</button><div className="mobile-brand-logo"><ShoppingBag size={16} color="white"/></div><div className="mobile-brand-text"><strong>團購百貨</strong><span>管理系統 · {APP_VERSION}</span></div></header>
      <main className="print-main app-main"><Outlet/>{location.pathname==='/incoming'&&<IncomingArchivePanel/>}</main>
    </div>
  </div>
}
