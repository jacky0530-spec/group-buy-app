import { useState, useEffect, useCallback, useMemo } from 'react'
import { OrdersAPI, ProductsAPI, CustomersAPI, effectiveOrderAmount, orderSnapshotCost } from '../lib/db'
import { getCustomerPhoneLast2 } from '../lib/customerSearch'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { TrendingUp, DollarSign, Package, Search, Printer, Download, WalletCards, ReceiptText, Building2 } from 'lucide-react'

const CAT_COLORS = { daily:'#3b82f6', frozen:'#06b6d4', clothing:'#ec4899', biscuit:'#f59e0b', candy:'#8b5cf6', other:'#6b7280' }
const CAT_LABELS = { daily:'日用品', frozen:'冷凍食品', clothing:'服飾', biscuit:'餅乾', candy:'糖果', other:'其他' }
const money = value => `NT$${Math.round(Number(value || 0)).toLocaleString()}`
const dateText = value => value ? new Date(value).toLocaleDateString('zh-TW') : '—'

function specText(item) {
  const spec = item?.spec || {}
  return [spec.flavor && `口味:${spec.flavor}`, spec.color, spec.size].filter(Boolean).join(' / ')
}

function periodBounds(mode, month, start, end) {
  if (mode === 'month' && month) {
    const [year, mon] = month.split('-').map(Number)
    return [
      new Date(year, mon - 1, 1, 0, 0, 0).toISOString(),
      new Date(year, mon, 0, 23, 59, 59, 999).toISOString(),
    ]
  }
  if (mode === 'range' && start && end) {
    return [new Date(`${start}T00:00:00`).toISOString(), new Date(`${end}T23:59:59`).toISOString()]
  }
  return [null, null]
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function escapeCsv(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function exportCsv(orders, filename) {
  const rows = [['日期','客戶','商品','規格/口味','數量','售價','成本','狀態','收款','退款','有效訂單金額']]
  orders.forEach(order => {
    ;(order.items || []).forEach(item => rows.push([
      dateText(order.order_date),
      order.customer_name,
      item.product_name || item.name,
      specText(item),
      item.qty,
      item.sale_price ?? item.price ?? 0,
      item.cost_price ?? '',
      order.status,
      order.payment_status,
      order.refund_amount || 0,
      effectiveOrderAmount(order),
    ]))
  })
  downloadBlob(filename, '\ufeff' + rows.map(row => row.map(escapeCsv).join(',')).join('\n'), 'text/csv;charset=utf-8')
}

function exportExcel(orders, filename) {
  const body = orders.flatMap(order => (order.items || []).map(item => `
    <tr>
      <td>${dateText(order.order_date)}</td><td>${order.customer_name || ''}</td>
      <td>${item.product_name || item.name || ''}</td><td>${specText(item)}</td>
      <td>${item.qty || 0}</td><td>${item.sale_price ?? item.price ?? 0}</td>
      <td>${item.cost_price ?? ''}</td><td>${order.status || ''}</td>
      <td>${order.payment_status || ''}</td><td>${order.refund_amount || 0}</td>
      <td>${effectiveOrderAmount(order)}</td>
    </tr>`)).join('')
  const html = `\ufeff<html><head><meta charset="utf-8"></head><body><table border="1">
    <tr><th>日期</th><th>客戶</th><th>商品</th><th>規格/口味</th><th>數量</th><th>售價</th><th>成本</th><th>狀態</th><th>收款</th><th>退款</th><th>有效訂單金額</th></tr>
    ${body}</table></body></html>`
  downloadBlob(filename, html, 'application/vnd.ms-excel;charset=utf-8')
}

export default function Reports() {
  const currentMonth = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [])

  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterMode, setFilterMode] = useState('month')
  const [inputMonth, setInputMonth] = useState(currentMonth)
  const [inputStart, setInputStart] = useState('')
  const [inputEnd, setInputEnd] = useState('')
  const [activeTab, setActiveTab] = useState('summary')
  const [buyerSearch, setBuyerSearch] = useState('')
  const [trackProd, setTrackProd] = useState(null)
  const [prodSearch, setProdSearch] = useState('')

  const loadMasters = useCallback(async () => {
    try {
      const [prods, custs] = await Promise.all([
        ProductsAPI.list({ includeArchived:true }),
        CustomersAPI.list({ includeArchived:true }),
      ])
      setProducts(prods)
      setCustomers(custs)
    } catch (err) {
      setError(`主檔載入失敗：${err.message}`)
    }
  }, [])

  const loadOrders = useCallback(async () => {
    if (filterMode === 'range' && (!inputStart || !inputEnd)) return
    setLoading(true)
    setError('')
    try {
      const [start, end] = periodBounds(filterMode, inputMonth, inputStart, inputEnd)
      const rows = start && end ? await OrdersAPI.listByDateRange(start, end) : await OrdersAPI.list()
      setOrders(rows)
    } catch (err) {
      setError(`訂單報表載入失敗：${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [filterMode, inputMonth, inputStart, inputEnd])

  useEffect(() => { loadMasters() }, [loadMasters])
  useEffect(() => { loadOrders() }, [loadOrders])

  const currentCostMap = Object.fromEntries(products.map(p => [p.id, Number(p.cost || 0)]))
  const currentCatMap = Object.fromEntries(products.map(p => [p.id, p.category || 'other']))
  const validOrders = orders.filter(order => order.status !== 'cancelled')
  const shippedOrders = validOrders.filter(order => order.status === 'shipped')
  const cancelledOrders = orders.filter(order => order.status === 'cancelled')

  const orderValue = validOrders.reduce((sum, order) => sum + effectiveOrderAmount(order), 0)
  const shippedRevenue = shippedOrders.reduce((sum, order) => sum + effectiveOrderAmount(order), 0)
  const shippedCost = shippedOrders.reduce((sum, order) => sum + orderSnapshotCost(order, currentCostMap), 0)
  const shippedProfit = shippedRevenue - shippedCost
  const collectedAmount = validOrders.filter(order => ['paid','partial_refund','refunded'].includes(order.payment_status)).reduce((sum, order) => sum + effectiveOrderAmount(order), 0)
  const outstandingAmount = validOrders.filter(order => order.payment_status === 'unpaid').reduce((sum, order) => sum + effectiveOrderAmount(order), 0)
  const refundAmount = validOrders.reduce((sum, order) => sum + Number(order.refund_amount || 0), 0)
  const cancelledAmount = cancelledOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0)
  const supplierPaidCost = validOrders.filter(order => order.payable_status === 'paid').reduce((sum, order) => sum + orderSnapshotCost(order, currentCostMap), 0)
  const payableOutstanding = validOrders.filter(order => order.payable_status !== 'paid').reduce((sum, order) => sum + orderSnapshotCost(order, currentCostMap), 0)
  const netCashFlow = collectedAmount - supplierPaidCost

  const trendData = useMemo(() => {
    const map = {}
    shippedOrders.forEach(order => {
      const d = new Date(order.order_date)
      const key = filterMode === 'all' ? `${d.getFullYear()}/${d.getMonth() + 1}月` : `${d.getMonth() + 1}/${d.getDate()}`
      map[key] = (map[key] || 0) + effectiveOrderAmount(order)
    })
    return Object.entries(map).map(([date, amount]) => ({ date, amount }))
  }, [shippedOrders, filterMode])

  const topProds = useMemo(() => {
    const map = {}
    validOrders.forEach(order => (order.items || []).forEach(item => {
      const key = item.product_id || item.id || item.product_name || item.name
      if (!map[key]) map[key] = { name:item.product_name || item.name || '未命名商品', qty:0, revenue:0 }
      map[key].qty += Number(item.qty || 0)
      map[key].revenue += Number(item.sale_price ?? item.price ?? 0) * Number(item.qty || 0)
    }))
    return Object.values(map).sort((a,b) => b.qty - a.qty).slice(0, 8).map(row => ({ ...row, chartName:row.name.length > 12 ? `${row.name.slice(0,12)}…` : row.name }))
  }, [validOrders])

  const catData = useMemo(() => {
    const map = {}
    validOrders.forEach(order => (order.items || []).forEach(item => {
      const category = item.category || currentCatMap[item.product_id || item.id] || 'other'
      map[category] = (map[category] || 0) + Number(item.sale_price ?? item.price ?? 0) * Number(item.qty || 0)
    }))
    return Object.entries(map).map(([category, value]) => ({ name:CAT_LABELS[category] || category, value, color:CAT_COLORS[category] || '#999' }))
  }, [validOrders, currentCatMap])

  const filteredProducts = products.filter(p => p.active !== false && p.name.toLowerCase().includes(prodSearch.toLowerCase()))
  const trackBuyers = useMemo(() => {
    if (!trackProd) return []
    const map = {}
    validOrders.forEach(order => {
      const matches = (order.items || []).filter(item => (item.product_id || item.id) === trackProd.id || (item.product_name || item.name) === trackProd.name)
      if (!matches.length) return
      const key = order.customer_id || `${order.customer_name}|${order.customer_phone_last2 || ''}`
      if (!map[key]) map[key] = { name:order.customer_name, qty:0, pending:0, total:0 }
      matches.forEach(item => {
        const qty = Number(item.qty || 0)
        map[key].qty += qty
        if (order.status === 'pending') map[key].pending += qty
        map[key].total += Number(item.sale_price ?? item.price ?? 0) * qty
      })
    })
    return Object.values(map).sort((a,b) => b.qty - a.qty)
  }, [trackProd, validOrders])

  const customerMap = Object.fromEntries(customers.map(c => [c.id, c]))
  const buyerRows = useMemo(() => {
    const map = {}
    validOrders.forEach(order => {
      const customer = customerMap[order.customer_id] || {}
      const id = order.customer_id || `${order.customer_name}|${order.customer_phone_last2 || order.customer_phone || ''}`
      if (!map[id]) {
        const phone = String(order.customer_phone || customer.phone || '').trim()
        const phoneLast2 = String(order.customer_phone_last2 || getCustomerPhoneLast2(customer) || '').trim()
        map[id] = {
          id,
          name:order.customer_name,
          phone,
          phone_last2:phoneLast2,
          line_nick:customer.line_nick || '',
          fb_name:customer.fb_name || '',
          orders:[],
        }
      }
      map[id].orders.push(order)
    })
    return Object.values(map)
  }, [validOrders, customerMap])

  const filteredBuyers = buyerRows.filter(buyer => {
    const q = buyerSearch.trim().toLowerCase()
    if (!q) return true
    return [buyer.name, buyer.phone, buyer.phone_last2, buyer.line_nick, buyer.fb_name]
      .some(value => String(value || '').toLowerCase().includes(q))
  })

  const supplierRows = useMemo(() => {
    const map = {}
    validOrders.forEach(order => (order.items || []).forEach(item => {
      const supplier = item.supplier || '未指定供應商'
      if (!map[supplier]) map[supplier] = { supplier, total:0, paid:0, outstanding:0 }
      const fallback = currentCostMap[item.product_id || item.id] || 0
      const cost = Number(item.cost_price ?? fallback) * Number(item.qty || 0)
      map[supplier].total += cost
      if (order.payable_status === 'paid') map[supplier].paid += cost
      else map[supplier].outstanding += cost
    }))
    return Object.values(map).sort((a,b) => b.outstanding - a.outstanding)
  }, [validOrders, currentCostMap])

  const monthlyRows = useMemo(() => {
    const map = {}
    shippedOrders.forEach(order => {
      const d = new Date(order.order_date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`
      if (!map[key]) map[key] = { month:key, revenue:0, cost:0 }
      map[key].revenue += effectiveOrderAmount(order)
      map[key].cost += orderSnapshotCost(order, currentCostMap)
    })
    return Object.values(map).sort((a,b) => a.month.localeCompare(b.month)).map(row => ({ ...row, profit:row.revenue - row.cost }))
  }, [shippedOrders, currentCostMap])

  const periodLabel = filterMode === 'all' ? '全部期間' : filterMode === 'month' ? inputMonth : `${inputStart || '?'}-${inputEnd || '?'}`

  return (
    <div className="animate-fade">
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div><h2 style={{ fontSize:22, fontWeight:800 }}>銷售與財務報表</h2><p style={{ color:'var(--text-secondary)', fontSize:13, marginTop:2 }}>取消單排除、退款扣除、成本採下單時快照</p></div>
        <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
          <button className="btn btn-ghost" onClick={() => exportCsv(validOrders, `group-buy-${periodLabel}.csv`)}><Download size={13}/>CSV</button>
          <button className="btn btn-ghost" onClick={() => exportExcel(validOrders, `group-buy-${periodLabel}.xls`)}><Download size={13}/>Excel</button>
          <button className="btn btn-ghost" onClick={() => window.print()}><Printer size={14}/>列印</button>
        </div>
      </div>

      <div style={{ background:'var(--surface)', borderRadius:'var(--radius)', padding:'14px 16px', marginBottom:18, display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', boxShadow:'var(--shadow-sm)' }}>
        {[['month','指定月份'],['range','自訂區間'],['all','全部歷史']].map(([value,label]) => <button key={value} className={`btn btn-sm ${filterMode === value ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilterMode(value)}>{label}</button>)}
        {filterMode === 'month' && <input type="month" value={inputMonth} onChange={e => setInputMonth(e.target.value)}/>} 
        {filterMode === 'range' && <><input type="date" value={inputStart} onChange={e => setInputStart(e.target.value)}/><span>〜</span><input type="date" value={inputEnd} onChange={e => setInputEnd(e.target.value)}/></>}
        <span style={{ marginLeft:'auto', color:'var(--text-muted)', fontSize:12 }}>{loading ? '讀取中...' : `${orders.length} 筆`}</span>
      </div>

      {error && <div style={{ background:'var(--rose-light)', color:'var(--rose)', padding:12, borderRadius:8, marginBottom:14 }}>{error}</div>}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))', gap:12, marginBottom:18 }}>
        {[
          { label:'有效訂單總額', value:orderValue, icon:ReceiptText, bg:'linear-gradient(135deg,#6366f1,#4338ca)' },
          { label:'已出貨營收', value:shippedRevenue, icon:DollarSign, bg:'linear-gradient(135deg,#10b981,#059669)' },
          { label:'已收款淨額', value:collectedAmount, icon:WalletCards, bg:'linear-gradient(135deg,#0ea5e9,#0284c7)' },
          { label:'未收款', value:outstandingAmount, icon:ReceiptText, bg:'linear-gradient(135deg,#f59e0b,#d97706)' },
          { label:'已出貨毛利', value:shippedProfit, icon:TrendingUp, bg:'linear-gradient(135deg,#14b8a6,#0f766e)' },
          { label:'退款', value:refundAmount, icon:Package, bg:'linear-gradient(135deg,#f43f5e,#be123c)' },
        ].map(card => { const Icon = card.icon; return <div key={card.label} className="stat-card" style={{ background:card.bg }}><div style={{ fontSize:11, fontWeight:700, opacity:.8 }}>{card.label}</div><div style={{ fontSize:21, fontWeight:900, marginTop:5 }}>{loading ? '—' : money(card.value)}</div><Icon size={27} style={{ position:'absolute', right:14, top:'50%', transform:'translateY(-50%)', opacity:.22 }}/></div> })}
      </div>

      <div style={{ background:'var(--surface-2)', borderRadius:10, padding:'9px 12px', marginBottom:18, fontSize:12, color:'var(--text-secondary)' }}>有效訂單＝非取消訂單－退款；已出貨毛利＝已出貨營收－歷史成本快照。取消金額 {money(cancelledAmount)} 不計入營收、毛利、應收與應付。</div>

      <div className="tabs" style={{ marginBottom:18 }}>
        <button className={`tab ${activeTab === 'summary' ? 'active' : ''}`} onClick={() => setActiveTab('summary')}>📊 銷售分析</button>
        <button className={`tab ${activeTab === 'buyer' ? 'active' : ''}`} onClick={() => setActiveTab('buyer')}>👥 買家查詢</button>
        <button className={`tab ${activeTab === 'finance' ? 'active' : ''}`} onClick={() => setActiveTab('finance')}>💰 財務 / 損益</button>
      </div>

      {activeTab === 'summary' && <>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:14, marginBottom:18 }}>
          <div className="card"><div className="card-header" style={{ fontWeight:700 }}>📈 已出貨營收趨勢</div><div style={{ padding:'16px 8px' }}>{trendData.length === 0 ? <div className="empty-state">此期間無已出貨資料</div> : <ResponsiveContainer width="100%" height={220}><LineChart data={trendData}><XAxis dataKey="date" tick={{ fontSize:11 }}/><YAxis tick={{ fontSize:11 }}/><Tooltip formatter={value => [money(value),'已出貨營收']}/><Line type="monotone" dataKey="amount" stroke="#6366f1" strokeWidth={2.5}/></LineChart></ResponsiveContainer>}</div></div>
          <div className="card"><div className="card-header" style={{ fontWeight:700 }}>🏷️ 分類佔比</div><div style={{ padding:'16px 8px' }}>{catData.length === 0 ? <div className="empty-state">無資料</div> : <ResponsiveContainer width="100%" height={220}><PieChart><Pie data={catData} cx="50%" cy="50%" outerRadius={76} dataKey="value" label={({name,percent}) => `${name} ${Math.round(percent * 100)}%`} labelLine={false} fontSize={10}>{catData.map((entry,index) => <Cell key={`${entry.name}-${index}`} fill={entry.color}/>)}</Pie><Tooltip formatter={value => [money(value)]}/></PieChart></ResponsiveContainer>}</div></div>
        </div>
        <div className="card" style={{ marginBottom:18 }}><div className="card-header" style={{ fontWeight:700 }}>🏆 熱銷商品 Top 8</div><div style={{ padding:'16px 8px' }}>{topProds.length === 0 ? <div className="empty-state">無資料</div> : <ResponsiveContainer width="100%" height={230}><BarChart data={topProds} layout="vertical"><XAxis type="number" tick={{ fontSize:11 }}/><YAxis dataKey="chartName" type="category" width={115} tick={{ fontSize:11 }}/><Tooltip formatter={value => [`${value} 件`,'數量']}/><Bar dataKey="qty" fill="#6366f1"/></BarChart></ResponsiveContainer>}</div></div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <div className="card"><div className="card-header" style={{ fontWeight:700 }}>🔍 商品買家追蹤</div><div className="card-body"><div className="search-input-wrap" style={{ marginBottom:10 }}><Search size={14}/><input value={prodSearch} onChange={e => setProdSearch(e.target.value)} placeholder="搜尋商品..." style={{ padding:'8px 8px 8px 32px', width:'100%' }}/></div><div style={{ maxHeight:300, overflowY:'auto' }}>{filteredProducts.map(product => <div key={product.id} onClick={() => setTrackProd(product)} style={{ padding:'8px 10px', cursor:'pointer', borderRadius:8, background:trackProd?.id === product.id ? 'var(--indigo-light)' : 'transparent', fontWeight:trackProd?.id === product.id ? 700 : 400 }}>{product.name}</div>)}</div></div></div>
          <div className="card"><div className="card-header" style={{ fontWeight:700 }}>{trackProd ? `${trackProd.name} — 買家名單` : '請選商品'}</div><div className="table-container"><table><thead><tr><th>客戶</th><th>總數</th><th>未出</th><th>金額</th></tr></thead><tbody>{trackBuyers.map((buyer,index) => <tr key={`${buyer.name}-${index}`}><td>{buyer.name}</td><td>{buyer.qty}</td><td>{buyer.pending || '—'}</td><td>{money(buyer.total)}</td></tr>)}</tbody></table></div></div>
        </div>
      </>}

      {activeTab === 'buyer' && <>
        <div className="search-input-wrap" style={{ maxWidth:500, marginBottom:14 }}><Search size={14}/><input value={buyerSearch} onChange={e => setBuyerSearch(e.target.value)} placeholder="搜尋姓名、手機、末兩碼、Line、FB..." style={{ padding:'8px 8px 8px 32px', width:'100%' }}/></div>
        <div className="card"><div className="table-container"><table><thead><tr><th>客戶</th><th>聯絡辨識</th><th>訂單數</th><th>有效金額</th><th>商品明細</th></tr></thead><tbody>{filteredBuyers.map(buyer => <tr key={buyer.id}><td style={{ fontWeight:800 }}>{buyer.name}</td><td style={{ fontSize:12, color:'var(--text-secondary)' }}>{[buyer.phone && `手機:${buyer.phone}`, buyer.phone_last2 && `末碼:${buyer.phone_last2}`, buyer.line_nick && `Line:${buyer.line_nick}`, buyer.fb_name && `FB:${buyer.fb_name}`].filter(Boolean).join(' / ') || '—'}</td><td>{buyer.orders.length}</td><td style={{ fontWeight:800, color:'var(--indigo)' }}>{money(buyer.orders.reduce((sum,order) => sum + effectiveOrderAmount(order),0))}</td><td style={{ fontSize:12 }}>{buyer.orders.flatMap(order => (order.items || []).map((item,index) => <div key={`${order.id}-${index}`}>{item.product_name || item.name}{specText(item) ? `（${specText(item)}）` : ''} ×{item.qty}</div>))}</td></tr>)}</tbody></table></div></div>
      </>}

      {activeTab === 'finance' && <>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))', gap:12, marginBottom:16 }}>
          {[
            ['應收帳款（未收款）', outstandingAmount, WalletCards, 'var(--rose-light)', 'var(--rose)'],
            ['應付帳款（供應商未付款）', payableOutstanding, Building2, 'var(--amber-light)', '#b45309'],
            ['已付供應商成本', supplierPaidCost, Building2, 'var(--emerald-light)', 'var(--emerald)'],
            ['現金流淨額', netCashFlow, DollarSign, 'var(--sky-light)', '#0369a1'],
          ].map(([label,value,Icon,bg,color]) => <div key={label} style={{ background:bg, borderRadius:10, padding:14, position:'relative' }}><div style={{ fontSize:11, color, fontWeight:700 }}>{label}</div><div style={{ fontSize:20, color, fontWeight:900, marginTop:5 }}>{money(value)}</div><Icon size={24} style={{ position:'absolute', right:12, top:16, color, opacity:.35 }}/></div>)}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <div className="card"><div className="card-header" style={{ fontWeight:700 }}>🏭 供應商應付帳款</div><div className="table-container"><table><thead><tr><th>供應商</th><th>總成本</th><th>已付</th><th>未付</th></tr></thead><tbody>{supplierRows.map(row => <tr key={row.supplier}><td>{row.supplier}</td><td>{money(row.total)}</td><td>{money(row.paid)}</td><td style={{ fontWeight:800, color:row.outstanding ? 'var(--rose)' : 'var(--emerald)' }}>{money(row.outstanding)}</td></tr>)}</tbody></table></div></div>
          <div className="card"><div className="card-header" style={{ fontWeight:700 }}>📆 月損益（已出貨）</div><div className="table-container"><table><thead><tr><th>月份</th><th>營收</th><th>成本</th><th>毛利</th></tr></thead><tbody>{monthlyRows.map(row => <tr key={row.month}><td>{row.month}</td><td>{money(row.revenue)}</td><td>{money(row.cost)}</td><td style={{ fontWeight:800, color:row.profit >= 0 ? 'var(--emerald)' : 'var(--rose)' }}>{money(row.profit)}</td></tr>)}</tbody></table></div></div>
        </div>
      </>}
    </div>
  )
}
