import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingBag, Users, ShoppingCart, BarChart2, TrendingUp, Clock, Package } from 'lucide-react'
import { StatsAPI } from '../lib/db'

const CARDS = [
  { to: '/products',  icon: ShoppingBag,  label: '商品管理', desc: '建立商品庫，設定成本與售價', color: '#10b981', bg: '#ecfdf5' },
  { to: '/customers', icon: Users,        label: '客戶管理', desc: '維護客戶名單、Line 及 FB 暱稱', color: '#6366f1', bg: '#eef2ff' },
  { to: '/orders',    icon: ShoppingCart, label: '訂單管理', desc: '開立訂單、出貨追蹤與結帳',    color: '#f59e0b', bg: '#fffbeb' },
  { to: '/reports',   icon: BarChart2,    label: '銷售報表', desc: '營收趨勢、熱銷商品分析',      color: '#0ea5e9', bg: '#f0f9ff' },
]

const STATUS_CFG = {
  pending:   { label: '待出貨', badge: 'badge-amber' },
  shipped:   { label: '已出貨', badge: 'badge-emerald' },
  cancelled: { label: '已取消', badge: 'badge-rose' },
}

export default function Home() {
  const [stats, setStats] = useState({ productCount:0, customerCount:0, pendingCount:0, revenue:0, recentOrders:[] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    StatsAPI.getSummary().then(s => { setStats(s); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  return (
    <div className="animate-fade">
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.5px' }}>🛍️ 團購百貨管理中心</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: 14 }}>
          FB 社團團購專用 — 日用品・冷凍食品・服飾・餅乾・糖果
        </p>
      </div>

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 14, marginBottom: 28 }}>
        {[
          { label: '商品數',   value: stats.productCount,                icon: Package,   bg: 'linear-gradient(135deg,#10b981,#059669)' },
          { label: '客戶數',   value: stats.customerCount,               icon: Users,     bg: 'linear-gradient(135deg,#6366f1,#4338ca)' },
          { label: '待出貨',   value: stats.pendingCount,                icon: Clock,     bg: 'linear-gradient(135deg,#f59e0b,#d97706)' },
          { label: '累積營收', value: `$${(stats.revenue||0).toLocaleString()}`, icon: TrendingUp, bg: 'linear-gradient(135deg,#0ea5e9,#0284c7)' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ background: s.bg }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: .6, opacity: .8, textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-1px', position: 'relative', zIndex: 1 }}>
              {loading ? '—' : s.value}
            </div>
            <s.icon size={32} style={{ position:'absolute', right:16, top:'50%', transform:'translateY(-50%)', opacity:.22, zIndex:0 }} />
          </div>
        ))}
      </div>

      {/* Entry cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px,1fr))', gap: 16, marginBottom: 28 }}>
        {CARDS.map(({ to, icon: Icon, label, desc, color, bg }) => (
          <Link key={to} to={to} style={{ textDecoration: 'none' }}>
            <div className="card" style={{ padding: 24, cursor: 'pointer', background: bg, border: `1.5px solid ${color}22`, transition: 'transform .2s, box-shadow .2s' }}
              onMouseEnter={e => { e.currentTarget.style.transform='translateY(-4px)'; e.currentTarget.style.boxShadow=`0 12px 32px ${color}22` }}
              onMouseLeave={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow='' }}>
              <div style={{ width:48,height:48,borderRadius:14,background:color,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:14 }}>
                <Icon size={22} color="white" />
              </div>
              <div style={{ fontWeight:800, fontSize:16, marginBottom:4 }}>{label}</div>
              <div style={{ fontSize:13, color:'var(--text-secondary)' }}>{desc}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent orders */}
      <div className="card">
        <div className="card-header" style={{ justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, fontWeight:700 }}>
            <Clock size={16} color="var(--indigo)" /> 最新訂單
          </div>
          <Link to="/orders" style={{ fontSize:13, color:'var(--indigo)', textDecoration:'none', fontWeight:600 }}>查看全部 →</Link>
        </div>
        <div className="table-container">
          <table>
            <thead><tr><th>客戶</th><th>金額</th><th>狀態</th><th>日期</th></tr></thead>
            <tbody>
              {stats.recentOrders.length === 0 && !loading && (
                <tr><td colSpan={4} style={{ textAlign:'center', color:'var(--text-muted)', padding:24 }}>尚無訂單</td></tr>
              )}
              {stats.recentOrders.map(o => {
                const scfg = STATUS_CFG[o.status] || STATUS_CFG.pending
                return (
                  <tr key={o.id}>
                    <td style={{ fontWeight:600 }}>{o.customer_name}</td>
                    <td style={{ fontWeight:700, color:'var(--indigo)' }}>${(o.total_amount||0).toLocaleString()}</td>
                    <td><span className={`badge ${scfg.badge}`}>{scfg.label}</span></td>
                    <td style={{ color:'var(--text-secondary)', fontSize:13 }}>
                      {o.order_date ? new Date(o.order_date).toLocaleDateString('zh-TW') : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
