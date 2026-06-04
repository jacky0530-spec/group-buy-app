import { useState, useEffect, useCallback, useRef } from 'react'
import { OrdersAPI, ProductsAPI, CustomersAPI } from '../lib/db'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { TrendingUp, DollarSign, Package, Users, Search, Printer, ChevronDown } from 'lucide-react'

const CAT_COLORS = { daily:'#3b82f6', frozen:'#06b6d4', clothing:'#ec4899', biscuit:'#f59e0b', candy:'#8b5cf6', other:'#6b7280' }
const CAT_LABELS = { daily:'日用品', frozen:'冷凍食品', clothing:'服飾', biscuit:'餅乾', candy:'糖果', other:'其他' }

// ── 列印專用區塊（畫面隱藏，列印時顯示）────────────────────
function PrintReport({ filteredOrders, totalRevenue, totalProfit, trendData, topProds, catData, filtBuyers, filterMode, inputMonth, inputStart, inputEnd }) {
  const periodLabel = filterMode==='month' ? inputMonth
    : filterMode==='range' && inputStart && inputEnd ? `${inputStart} ~ ${inputEnd}`
    : '全部期間'

  return (
    <div className="print-only" style={{ display:'none' }}>
      {/* 標題 */}
      <div style={{ textAlign:'center', marginBottom:16, paddingBottom:12, borderBottom:'2px solid #1e293b' }}>
        <div style={{ fontSize:20, fontWeight:900, color:'#1e293b' }}>🛍️ 團購百貨 銷售報表</div>
        <div style={{ fontSize:12, color:'#64748b', marginTop:4 }}>
          列印日期：{new Date().toLocaleDateString('zh-TW')}　查詢期間：{periodLabel}　共 {filteredOrders.length} 筆訂單
        </div>
      </div>

      {/* 摘要數據 */}
      <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:16, fontSize:13 }}>
        <thead>
          <tr style={{ background:'#1e293b', color:'#fff' }}>
            <th style={{ padding:'8px 12px', textAlign:'center' }}>總銷售額</th>
            <th style={{ padding:'8px 12px', textAlign:'center' }}>預估毛利</th>
            <th style={{ padding:'8px 12px', textAlign:'center' }}>訂單數量</th>
            <th style={{ padding:'8px 12px', textAlign:'center' }}>購買客戶</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ background:'#f8f9fc' }}>
            <td style={{ padding:'10px 12px', textAlign:'center', fontWeight:800, fontSize:15, color:'#6366f1' }}>NT${totalRevenue.toLocaleString()}</td>
            <td style={{ padding:'10px 12px', textAlign:'center', fontWeight:800, fontSize:15, color:'#10b981' }}>NT${totalProfit.toLocaleString()}</td>
            <td style={{ padding:'10px 12px', textAlign:'center', fontWeight:800, fontSize:15, color:'#f59e0b' }}>{filteredOrders.length} 筆</td>
            <td style={{ padding:'10px 12px', textAlign:'center', fontWeight:800, fontSize:15, color:'#0ea5e9' }}>{new Set(filteredOrders.map(o=>o.customer_id)).size} 人</td>
          </tr>
        </tbody>
      </table>

      {/* 兩欄：熱銷商品 + 分類佔比 */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:16 }}>
        <div>
          <div style={{ fontWeight:800, fontSize:12, marginBottom:4, padding:'5px 10px', background:'#1e293b', color:'#fff', borderRadius:'6px 6px 0 0' }}>🏆 熱銷商品 Top 8</div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
            <thead><tr style={{ background:'#f1f5f9' }}>
              <th style={{ padding:'5px 8px', textAlign:'left', border:'1px solid #e2e8f0' }}>商品名稱</th>
              <th style={{ padding:'5px 8px', textAlign:'center', border:'1px solid #e2e8f0' }}>數量</th>
              <th style={{ padding:'5px 8px', textAlign:'right', border:'1px solid #e2e8f0' }}>營收</th>
            </tr></thead>
            <tbody>
              {topProds.length===0 && <tr><td colSpan={3} style={{ padding:'8px', textAlign:'center', color:'#94a3b8', border:'1px solid #e2e8f0' }}>無資料</td></tr>}
              {topProds.map((p,i)=>(
                <tr key={i} style={{ background:i%2===0?'#fff':'#f8f9fc' }}>
                  <td style={{ padding:'5px 8px', border:'1px solid #e2e8f0' }}>{p.name}</td>
                  <td style={{ padding:'5px 8px', textAlign:'center', border:'1px solid #e2e8f0', fontWeight:700 }}>{p.qty}</td>
                  <td style={{ padding:'5px 8px', textAlign:'right', border:'1px solid #e2e8f0', fontWeight:700, color:'#6366f1' }}>NT${p.revenue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div style={{ fontWeight:800, fontSize:12, marginBottom:4, padding:'5px 10px', background:'#1e293b', color:'#fff', borderRadius:'6px 6px 0 0' }}>🏷️ 分類銷售佔比</div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
            <thead><tr style={{ background:'#f1f5f9' }}>
              <th style={{ padding:'5px 8px', textAlign:'left', border:'1px solid #e2e8f0' }}>分類</th>
              <th style={{ padding:'5px 8px', textAlign:'right', border:'1px solid #e2e8f0' }}>金額</th>
              <th style={{ padding:'5px 8px', textAlign:'right', border:'1px solid #e2e8f0' }}>佔比</th>
            </tr></thead>
            <tbody>
              {catData.length===0 && <tr><td colSpan={3} style={{ padding:'8px', textAlign:'center', color:'#94a3b8', border:'1px solid #e2e8f0' }}>無資料</td></tr>}
              {[...catData].sort((a,b)=>b.value-a.value).map((c,i)=>{
                const tot = catData.reduce((s,x)=>s+x.value,0)
                const pct = tot>0 ? Math.round(c.value/tot*100) : 0
                return (
                  <tr key={i} style={{ background:i%2===0?'#fff':'#f8f9fc' }}>
                    <td style={{ padding:'5px 8px', border:'1px solid #e2e8f0' }}>
                      <span style={{ display:'inline-block', width:9, height:9, borderRadius:2, background:c.color, marginRight:5, verticalAlign:'middle' }}/>
                      {c.name}
                    </td>
                    <td style={{ padding:'5px 8px', textAlign:'right', border:'1px solid #e2e8f0', fontWeight:700 }}>NT${c.value.toLocaleString()}</td>
                    <td style={{ padding:'5px 8px', textAlign:'right', border:'1px solid #e2e8f0', fontWeight:700, color:'#6366f1' }}>{pct}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 銷售趨勢 */}
      {trendData.length>0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ fontWeight:800, fontSize:12, marginBottom:4, padding:'5px 10px', background:'#1e293b', color:'#fff', borderRadius:'6px 6px 0 0' }}>📈 銷售趨勢</div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
            <thead><tr style={{ background:'#f1f5f9' }}>
              <th style={{ padding:'5px 8px', textAlign:'left', border:'1px solid #e2e8f0' }}>期間</th>
              <th style={{ padding:'5px 8px', textAlign:'right', border:'1px solid #e2e8f0' }}>銷售金額</th>
              <th style={{ padding:'5px 8px', textAlign:'left', border:'1px solid #e2e8f0' }}>比例</th>
            </tr></thead>
            <tbody>
              {trendData.map((t,i)=>{
                const maxAmt = Math.max(...trendData.map(x=>x.amount))
                const barW   = maxAmt>0 ? Math.round(t.amount/maxAmt*100) : 0
                return (
                  <tr key={i} style={{ background:i%2===0?'#fff':'#f8f9fc' }}>
                    <td style={{ padding:'5px 8px', border:'1px solid #e2e8f0' }}>{t.date}</td>
                    <td style={{ padding:'5px 8px', textAlign:'right', border:'1px solid #e2e8f0', fontWeight:700, color:'#6366f1' }}>NT${t.amount.toLocaleString()}</td>
                    <td style={{ padding:'5px 8px', border:'1px solid #e2e8f0' }}>
                      <div style={{ height:9, background:'#6366f1', width:`${barW}%`, borderRadius:3, minWidth:2 }}/>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 買家明細 */}
      {filtBuyers.length>0 && (
        <div>
          <div style={{ fontWeight:800, fontSize:12, marginBottom:4, padding:'5px 10px', background:'#1e293b', color:'#fff', borderRadius:'6px 6px 0 0' }}>👥 買家訂單明細</div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:10 }}>
            <thead><tr style={{ background:'#f1f5f9' }}>
              <th style={{ padding:'4px 7px', textAlign:'left', border:'1px solid #e2e8f0' }}>客戶</th>
              <th style={{ padding:'4px 7px', textAlign:'left', border:'1px solid #e2e8f0' }}>商品</th>
              <th style={{ padding:'4px 7px', textAlign:'center', border:'1px solid #e2e8f0' }}>出貨</th>
              <th style={{ padding:'4px 7px', textAlign:'center', border:'1px solid #e2e8f0' }}>收款</th>
              <th style={{ padding:'4px 7px', textAlign:'right', border:'1px solid #e2e8f0' }}>金額</th>
            </tr></thead>
            <tbody>
              {filtBuyers.map(buyer=>buyer.orders.map((o,oi)=>(
                <tr key={`${buyer.id}-${oi}`} style={{ background:oi%2===0?'#fff':'#f8f9fc' }}>
                  <td style={{ padding:'4px 7px', border:'1px solid #e2e8f0', fontWeight:oi===0?700:400, color:oi===0?'#1e293b':'transparent' }}>
                    {oi===0 ? buyer.name : '↳'}
                  </td>
                  <td style={{ padding:'4px 7px', border:'1px solid #e2e8f0' }}>
                    {(o.items||[]).map((item,ii)=>(
                      <div key={ii}>{item.name}{item.spec?.color||item.spec?.size?`（${[item.spec.color,item.spec.size].filter(Boolean).join('／')}）`:''} ×{item.qty}</div>
                    ))}
                  </td>
                  <td style={{ padding:'4px 7px', textAlign:'center', border:'1px solid #e2e8f0' }}>
                    {o.status==='shipped'?'✅':o.status==='cancelled'?'❌':'⏳'}
                  </td>
                  <td style={{ padding:'4px 7px', textAlign:'center', border:'1px solid #e2e8f0' }}>
                    {o.payment_status==='paid'?'💰':'⬜'}
                  </td>
                  <td style={{ padding:'4px 7px', textAlign:'right', border:'1px solid #e2e8f0', fontWeight:700, color:'#6366f1' }}>
                    NT${(o.total_amount||0).toLocaleString()}
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── 規格顯示
function specLabel(item) {
  if (!item?.spec) return ''
  const parts = []
  if (item.spec.color) parts.push(item.spec.color)
  if (item.spec.size)  parts.push(item.spec.size)
  return parts.length ? `（${parts.join('／')}）` : ''
}

export default function Reports() {
  const [allOrders,  setAllOrders]  = useState([])
  const [products,   setProducts]   = useState([])
  const [customers,  setCustomers]  = useState([])
  const [loading,    setLoading]    = useState(true)

  // 日期篩選
  const [filterMode, setFilterMode] = useState('all')
  const [inputMonth, setInputMonth] = useState(() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` })
  const [inputStart, setInputStart] = useState('')
  const [inputEnd,   setInputEnd]   = useState('')

  // 頁籤：chart | buyer
  const [activeTab, setActiveTab]  = useState('chart')

  // 買家查詢
  const [buyerSearch,      setBuyerSearch]      = useState('')
  const [buyerStatusFilter,setBuyerStatusFilter] = useState('all')   // all | pending | shipped
  const [buyerPayFilter,   setBuyerPayFilter]    = useState('all')   // all | unpaid | paid
  const [buyerProdFilter,  setBuyerProdFilter]   = useState('')       // product id
  const [prodDropOpen,     setProdDropOpen]      = useState(false)
  const [prodDropSearch,   setProdDropSearch]    = useState('')
  const prodDropRef = useRef(null)

  // 商品追蹤（圖表頁）
  const [trackProd,  setTrackProd]  = useState(null)
  const [prodSearch, setProdSearch] = useState('')

  useEffect(() => {
    const h = e => { if (prodDropRef.current && !prodDropRef.current.contains(e.target)) setProdDropOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const [ords, prods, custs] = await Promise.all([OrdersAPI.list(), ProductsAPI.list(), CustomersAPI.list()])
    setAllOrders(ords); setProducts(prods); setCustomers(custs)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // 日期篩選
  const filteredOrders = (() => {
    if (filterMode==='month') {
      const [y,m] = inputMonth.split('-')
      return allOrders.filter(o=>{ const d=new Date(o.order_date); return d.getFullYear()==y&&(d.getMonth()+1)==m })
    }
    if (filterMode==='range'&&inputStart&&inputEnd) {
      const s=new Date(inputStart+'T00:00:00'), e=new Date(inputEnd+'T23:59:59')
      return allOrders.filter(o=>{ const d=new Date(o.order_date); return d>=s&&d<=e })
    }
    return allOrders
  })()

  const costMap = Object.fromEntries(products.map(p=>[p.id, p.cost||0]))
  const catMap  = Object.fromEntries(products.map(p=>[p.id, p.category||'other']))

  const totalRevenue = filteredOrders.reduce((s,o)=>s+(o.total_amount||0),0)
  const totalCost    = filteredOrders.reduce((s,o)=>s+(o.items||[]).reduce((cs,item)=>cs+(costMap[item.id]||0)*item.qty,0),0)
  const totalProfit  = totalRevenue-totalCost
  const uniqueCusts  = new Set(filteredOrders.map(o=>o.customer_id)).size

  // 趨勢
  const trendMap = {}
  filteredOrders.forEach(o=>{
    const d=new Date(o.order_date)
    const key = filterMode==='all' ? `${d.getFullYear()}/${d.getMonth()+1}月` : `${d.getMonth()+1}/${d.getDate()}`
    trendMap[key]=(trendMap[key]||0)+(o.total_amount||0)
  })
  const trendData = Object.entries(trendMap).map(([date,amount])=>({date,amount}))

  // 熱銷
  const prodSales = {}
  filteredOrders.forEach(o=>(o.items||[]).forEach(item=>{
    if(!prodSales[item.name]) prodSales[item.name]={qty:0,revenue:0}
    prodSales[item.name].qty+=item.qty
    prodSales[item.name].revenue+=item.price*item.qty
  }))
  const topProds = Object.entries(prodSales).sort((a,b)=>b[1].qty-a[1].qty).slice(0,8)
    .map(([name,data])=>({ name:name.length>10?name.slice(0,10)+'…':name, ...data }))

  // 分類
  const catSales = {}
  filteredOrders.forEach(o=>(o.items||[]).forEach(item=>{
    const cat=catMap[item.id]||'other'
    catSales[cat]=(catSales[cat]||0)+item.price*item.qty
  }))
  const catData = Object.entries(catSales).map(([cat,value])=>({ name:CAT_LABELS[cat]||cat, value, color:CAT_COLORS[cat]||'#999' }))

  // 商品追蹤
  const trackBuyers = trackProd ? (() => {
    const map = {}
    filteredOrders.forEach(o=>{
      const found=(o.items||[]).find(i=>i.id===trackProd.id||i.name===trackProd.name)
      if(found){
        if(!map[o.customer_name]) map[o.customer_name]={qty:0,pending:0,total:0}
        map[o.customer_name].qty+=found.qty
        if(o.status==='pending') map[o.customer_name].pending+=found.qty
        map[o.customer_name].total+=found.price*found.qty
      }
    })
    return Object.entries(map).sort((a,b)=>b[1].qty-a[1].qty).map(([name,data])=>({name,...data}))
  })() : []

  const filtProds = products.filter(p=>p.name.toLowerCase().includes(prodSearch.toLowerCase()))

  // ── 買家查詢 ────────────────────────────────────────────────
  // 建立每位客戶的訂單摘要
  const buyerRows = (() => {
    const custMap = Object.fromEntries(customers.map(c=>[c.id,c]))
    const map = {}
    filteredOrders.forEach(o => {
      const cid = o.customer_id || o.customer_name
      if (!map[cid]) map[cid] = {
        id: cid,
        name: o.customer_name,
        line_nick: custMap[o.customer_id]?.line_nick || '',
        fb_name:   custMap[o.customer_id]?.fb_name   || '',
        orders: [],
      }
      map[cid].orders.push(o)
    })

    return Object.values(map).map(c => {
      const os = c.orders
      const totalAmt    = os.reduce((s,o)=>s+(o.total_amount||0),0)
      const pendingAmt  = os.filter(o=>o.status==='pending').reduce((s,o)=>s+(o.total_amount||0),0)
      const unpaidAmt   = os.filter(o=>o.payment_status==='unpaid'&&o.status!=='cancelled').reduce((s,o)=>s+(o.total_amount||0),0)
      const orderCount  = os.length
      const pendingCnt  = os.filter(o=>o.status==='pending').length
      const shippedCnt  = os.filter(o=>o.status==='shipped').length
      const unpaidCnt   = os.filter(o=>o.payment_status==='unpaid'&&o.status!=='cancelled').length
      const paidCnt     = os.filter(o=>o.payment_status==='paid').length
      return { ...c, totalAmt, pendingAmt, unpaidAmt, orderCount, pendingCnt, shippedCnt, unpaidCnt, paidCnt }
    })
  })()

  // 買家篩選後
  const selectedProd = products.find(p=>p.id===buyerProdFilter)

  const filtBuyers = buyerRows.filter(c => {
    const mName = !buyerSearch ||
      c.name.toLowerCase().includes(buyerSearch.toLowerCase()) ||
      (c.line_nick||'').toLowerCase().includes(buyerSearch.toLowerCase()) ||
      (c.fb_name||'').toLowerCase().includes(buyerSearch.toLowerCase())
    const mStatus =
      buyerStatusFilter==='all' ? true :
      buyerStatusFilter==='pending' ? c.pendingCnt > 0 :
      buyerStatusFilter==='shipped' ? c.shippedCnt > 0 : true
    const mPay =
      buyerPayFilter==='all' ? true :
      buyerPayFilter==='unpaid' ? c.unpaidCnt > 0 :
      buyerPayFilter==='paid'   ? c.paidCnt   > 0 : true
    const mProd = !buyerProdFilter ? true :
      c.orders.some(o=>(o.items||[]).some(i=>i.id===buyerProdFilter))
    return mName && mStatus && mPay && mProd
  })

  // 買家明細訂單（篩選條件）
  function getBuyerOrders(buyer) {
    return buyer.orders.filter(o => {
      const mStatus =
        buyerStatusFilter==='all' ? true :
        buyerStatusFilter==='pending' ? o.status==='pending' :
        buyerStatusFilter==='shipped' ? o.status==='shipped' : true
      const mPay =
        buyerPayFilter==='all' ? true :
        buyerPayFilter==='unpaid' ? o.payment_status==='unpaid'&&o.status!=='cancelled' :
        buyerPayFilter==='paid'   ? o.payment_status==='paid' : true
      const mProd = !buyerProdFilter ? true :
        (o.items||[]).some(i=>i.id===buyerProdFilter)
      return mStatus && mPay && mProd
    })
  }

  const filtProdsDrop = products.filter(p=>p.name.toLowerCase().includes(prodDropSearch.toLowerCase()))

  // 列印買家報表
  function printBuyerReport() { window.print() }

  return (
    <div className="animate-fade">
      {/* ── 列印專用區塊（畫面隱藏，列印時顯示）── */}
      <PrintReport
        filteredOrders={filteredOrders}
        totalRevenue={totalRevenue}
        totalProfit={totalProfit}
        trendData={trendData}
        topProds={topProds}
        catData={catData}
        filtBuyers={filtBuyers}
        filterMode={filterMode}
        inputMonth={inputMonth}
        inputStart={inputStart}
        inputEnd={inputEnd}
      />
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ fontSize:22,fontWeight:800 }}>銷售報表</h2>
          <p style={{ color:'var(--text-secondary)',fontSize:13,marginTop:2 }}>營收趨勢 • 熱銷分析 • 買家查詢</p>
        </div>
        <button className="btn btn-ghost" onClick={printBuyerReport}><Printer size={14}/>列印報表</button>
      </div>

      {/* 日期篩選 */}
      <div style={{ background:'var(--surface)',borderRadius:'var(--radius)',padding:'14px 16px',marginBottom:20,display:'flex',gap:12,flexWrap:'wrap',alignItems:'center',boxShadow:'var(--shadow-sm)' }}>
        <div style={{ display:'flex',gap:6 }}>
          {[['all','全部'],['month','指定月份'],['range','自訂區間']].map(([v,l])=>(
            <button key={v} className={`btn btn-sm ${filterMode===v?'btn-primary':'btn-ghost'}`} onClick={()=>setFilterMode(v)}>{l}</button>
          ))}
        </div>
        {filterMode==='month' && (
          <input type="month" value={inputMonth} onChange={e=>setInputMonth(e.target.value)}
            style={{ border:'1.5px solid var(--border)',borderRadius:8,padding:'6px 10px',fontSize:13,outline:'none',fontFamily:'inherit' }}/>
        )}
        {filterMode==='range' && (
          <div style={{ display:'flex',gap:8,alignItems:'center' }}>
            <input type="date" value={inputStart} onChange={e=>setInputStart(e.target.value)}
              style={{ border:'1.5px solid var(--border)',borderRadius:8,padding:'6px 10px',fontSize:13,outline:'none',fontFamily:'inherit' }}/>
            <span style={{ color:'var(--text-muted)' }}>〜</span>
            <input type="date" value={inputEnd} onChange={e=>setInputEnd(e.target.value)}
              style={{ border:'1.5px solid var(--border)',borderRadius:8,padding:'6px 10px',fontSize:13,outline:'none',fontFamily:'inherit' }}/>
          </div>
        )}
        <span style={{ fontSize:13,color:'var(--text-muted)',marginLeft:'auto' }}>共 {filteredOrders.length} 筆</span>
      </div>

      {/* Stat cards */}
      <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:14,marginBottom:20 }}>
        {[
          { label:'總銷售額', value:`NT$${totalRevenue.toLocaleString()}`, icon:DollarSign, bg:'linear-gradient(135deg,#6366f1,#4338ca)' },
          { label:'預估毛利', value:`NT$${totalProfit.toLocaleString()}`,  icon:TrendingUp, bg:'linear-gradient(135deg,#10b981,#059669)' },
          { label:'訂單數量', value:`${filteredOrders.length} 筆`,         icon:Package,   bg:'linear-gradient(135deg,#f59e0b,#d97706)' },
          { label:'購買客戶', value:`${uniqueCusts} 人`,                   icon:Users,     bg:'linear-gradient(135deg,#0ea5e9,#0284c7)' },
        ].map(s=>(
          <div key={s.label} className="stat-card" style={{ background:s.bg }}>
            <div style={{ fontSize:11,fontWeight:700,letterSpacing:.6,opacity:.8,textTransform:'uppercase',marginBottom:6 }}>{s.label}</div>
            <div style={{ fontSize:22,fontWeight:900,letterSpacing:'-1px',position:'relative',zIndex:1 }}>{loading?'—':s.value}</div>
            <s.icon size={28} style={{ position:'absolute',right:16,top:'50%',transform:'translateY(-50%)',opacity:.22 }}/>
          </div>
        ))}
      </div>

      {/* 頁籤 */}
      <div className="tabs" style={{ marginBottom:20 }}>
        <button className={`tab ${activeTab==='chart'?'active':''}`} onClick={()=>setActiveTab('chart')}>📊 圖表分析</button>
        <button className={`tab ${activeTab==='buyer'?'active':''}`} onClick={()=>setActiveTab('buyer')}>👥 買家查詢</button>
      </div>

      {/* ── 圖表分析頁籤 ── */}
      {activeTab==='chart' && (
        <div id="print-chart-section">
          <div style={{ display:'grid',gridTemplateColumns:'2fr 1fr',gap:14,marginBottom:20 }}>
            <div className="card">
              <div className="card-header" style={{ fontWeight:700 }}>📈 銷售趨勢</div>
              <div style={{ padding:'16px 8px' }}>
                {trendData.length===0
                  ? <div style={{ textAlign:'center',color:'var(--text-muted)',padding:40 }}>此期間無資料</div>
                  : <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={trendData}>
                        <XAxis dataKey="date" tick={{ fontSize:11 }}/>
                        <YAxis tick={{ fontSize:11 }}/>
                        <Tooltip formatter={v=>[`NT$${v.toLocaleString()}`,'營收']}/>
                        <Line type="monotone" dataKey="amount" stroke="#6366f1" strokeWidth={2.5} dot={{ r:3 }} activeDot={{ r:5 }}/>
                      </LineChart>
                    </ResponsiveContainer>
                }
              </div>
            </div>
            <div className="card">
              <div className="card-header" style={{ fontWeight:700 }}>🏷️ 分類佔比</div>
              <div style={{ padding:'16px 8px' }}>
                {catData.length===0
                  ? <div style={{ textAlign:'center',color:'var(--text-muted)',padding:40 }}>此期間無資料</div>
                  : <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={catData} cx="50%" cy="50%" outerRadius={78} dataKey="value"
                          label={({name,percent})=>`${name} ${Math.round(percent*100)}%`} labelLine={false} fontSize={10}>
                          {catData.map((e,i)=><Cell key={i} fill={e.color}/>)}
                        </Pie>
                        <Tooltip formatter={v=>[`NT$${v.toLocaleString()}`]}/>
                      </PieChart>
                    </ResponsiveContainer>
                }
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom:20 }}>
            <div className="card-header" style={{ fontWeight:700 }}>🏆 熱銷商品 Top 8</div>
            <div style={{ padding:'16px 8px' }}>
              {topProds.length===0
                ? <div style={{ textAlign:'center',color:'var(--text-muted)',padding:32 }}>此期間無資料</div>
                : <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={topProds} layout="vertical">
                      <XAxis type="number" tick={{ fontSize:11 }}/>
                      <YAxis dataKey="name" type="category" width={100} tick={{ fontSize:12 }}/>
                      <Tooltip formatter={v=>[`${v} 件`,'銷售數量']}/>
                      <Bar dataKey="qty" fill="#6366f1" radius={[0,4,4,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
              }
            </div>
          </div>

          {/* 商品買家追蹤 */}
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:14 }}>
            <div className="card">
              <div className="card-header" style={{ fontWeight:700 }}>🔍 商品買家追蹤</div>
              <div className="card-body">
                <div className="search-input-wrap" style={{ marginBottom:12 }}>
                  <Search size={14}/>
                  <input value={prodSearch} onChange={e=>setProdSearch(e.target.value)} placeholder="搜尋商品..."
                    style={{ padding:'8px 8px 8px 32px',border:'1.5px solid var(--border)',borderRadius:8,fontSize:14,outline:'none',fontFamily:'inherit',background:'var(--surface)',width:'100%' }}/>
                </div>
                <div style={{ maxHeight:300,overflowY:'auto' }}>
                  {filtProds.map(p=>(
                    <div key={p.id} onClick={()=>setTrackProd(p)}
                      style={{ padding:'9px 12px',borderRadius:8,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',background:trackProd?.id===p.id?'var(--indigo-light)':'transparent',color:trackProd?.id===p.id?'var(--indigo-dark)':'var(--text-primary)',fontWeight:trackProd?.id===p.id?700:400,transition:'all .15s',marginBottom:2 }}>
                      <span>{p.name}</span>
                      {trackProd?.id===p.id && <span style={{ fontSize:11,background:'var(--indigo)',color:'#fff',padding:'2px 7px',borderRadius:99 }}>追蹤中</span>}
                    </div>
                  ))}
                  {filtProds.length===0 && <div style={{ color:'var(--text-muted)',textAlign:'center',padding:24 }}>無商品</div>}
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-header" style={{ fontWeight:700 }}>
                {trackProd ? `📦 ${trackProd.name} — 買家名單` : '選擇商品以查看買家'}
              </div>
              {!trackProd && <div style={{ textAlign:'center',color:'var(--text-muted)',padding:48 }}>← 請先點選商品</div>}
              {trackProd && trackBuyers.length===0 && <div style={{ textAlign:'center',color:'var(--text-muted)',padding:48 }}>此商品在選定期間無訂單</div>}
              {trackProd && trackBuyers.length>0 && (
                <div className="table-container">
                  <table>
                    <thead><tr>
                      <th>客戶</th>
                      <th style={{ textAlign:'center' }}>總數</th>
                      <th style={{ textAlign:'center',color:'var(--rose)' }}>未出</th>
                      <th style={{ textAlign:'right' }}>金額</th>
                    </tr></thead>
                    <tbody>
                      {trackBuyers.map(b=>(
                        <tr key={b.name}>
                          <td style={{ fontWeight:600 }}>{b.name}</td>
                          <td style={{ textAlign:'center',fontWeight:800,color:'var(--indigo)' }}>{b.qty}</td>
                          <td style={{ textAlign:'center',fontWeight:800,color:b.pending>0?'var(--rose)':'var(--text-muted)' }}>{b.pending||'—'}</td>
                          <td style={{ textAlign:'right',fontWeight:700,color:'var(--text-secondary)' }}>NT${b.total.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 買家查詢頁籤 ── */}
      {activeTab==='buyer' && (
        <div id="print-buyer-section">
          {/* 篩選列 */}
          <div style={{ background:'var(--surface)',borderRadius:'var(--radius)',padding:'14px 16px',marginBottom:16,display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',boxShadow:'var(--shadow-sm)' }}>
            {/* 姓名搜尋 */}
            <div className="search-input-wrap" style={{ flex:1,minWidth:160 }}>
              <Search size={14}/>
              <input value={buyerSearch} onChange={e=>setBuyerSearch(e.target.value)} placeholder="搜尋客戶姓名、Line、FB..."
                style={{ padding:'7px 7px 7px 30px',border:'1.5px solid var(--border)',borderRadius:8,fontSize:13,outline:'none',fontFamily:'inherit',background:'var(--surface)',width:'100%' }}/>
            </div>

            {/* 出貨狀態篩選 */}
            <div style={{ display:'flex',gap:5 }}>
              {[['all','出貨：全部'],['pending','未出貨'],['shipped','已出貨']].map(([v,l])=>(
                <button key={v} className={`btn btn-sm ${buyerStatusFilter===v?'btn-primary':'btn-ghost'}`} onClick={()=>setBuyerStatusFilter(v)}>{l}</button>
              ))}
            </div>

            {/* 付款狀態篩選 */}
            <div style={{ display:'flex',gap:5 }}>
              {[['all','收款：全部'],['unpaid','未收款'],['paid','已收款']].map(([v,l])=>(
                <button key={v} className={`btn btn-sm ${buyerPayFilter===v?'btn-primary':'btn-ghost'}`} onClick={()=>setBuyerPayFilter(v)}>{l}</button>
              ))}
            </div>

            {/* 商品篩選下拉 */}
            <div className="dropdown" ref={prodDropRef} style={{ minWidth:160 }}>
              <button type="button" className="btn btn-ghost btn-sm"
                style={{ width:'100%',justifyContent:'space-between' }}
                onClick={()=>setProdDropOpen(p=>!p)}>
                <span style={{ color:buyerProdFilter?'var(--text-primary)':'var(--text-muted)',fontSize:13 }}>
                  {selectedProd ? selectedProd.name : '商品：全部'}
                </span>
                <ChevronDown size={12}/>
              </button>
              {prodDropOpen && (
                <div className="dropdown-menu" style={{ width:220 }}>
                  <div style={{ padding:'7px 10px',borderBottom:'1px solid var(--border)',position:'sticky',top:0,background:'var(--surface)' }}>
                    <input autoFocus value={prodDropSearch} onChange={e=>setProdDropSearch(e.target.value)}
                      placeholder="搜尋商品..." style={{ width:'100%',padding:'5px 8px',border:'1px solid var(--border)',borderRadius:6,fontSize:12,outline:'none',fontFamily:'inherit' }}
                      onClick={e=>e.stopPropagation()}/>
                  </div>
                  <div className="dropdown-item" onClick={()=>{ setBuyerProdFilter(''); setProdDropOpen(false) }}>
                    <span style={{ color:'var(--text-muted)' }}>全部商品</span>
                  </div>
                  {filtProdsDrop.map(p=>(
                    <div key={p.id} className="dropdown-item" onClick={()=>{ setBuyerProdFilter(p.id); setProdDropOpen(false) }}>
                      {p.name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <span style={{ fontSize:12,color:'var(--text-muted)',marginLeft:'auto' }}>共 {filtBuyers.length} 位</span>
          </div>

          {/* 買家表格 */}
          {filtBuyers.length===0 ? (
            <div className="card"><div className="empty-state"><Users size={36}/><span>無符合條件的買家</span></div></div>
          ) : (
            <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
              {filtBuyers.map(buyer=>{
                const buyerOrders = getBuyerOrders(buyer)
                const buyerTotal  = buyerOrders.reduce((s,o)=>s+(o.total_amount||0),0)
                return (
                  <div key={buyer.id} className="card" style={{ overflow:'hidden' }}>
                    {/* 客戶標題 */}
                    <div style={{ padding:'10px 16px',background:'var(--surface-2)',borderBottom:'1.5px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8 }}>
                      <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                        <div style={{ width:34,height:34,borderRadius:'50%',background:'var(--indigo-light)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:15,color:'var(--indigo)',flexShrink:0 }}>
                          {buyer.name.charAt(0)}
                        </div>
                        <div>
                          <div style={{ fontWeight:800,fontSize:15 }}>{buyer.name}</div>
                          <div style={{ fontSize:11,color:'var(--text-muted)',display:'flex',gap:8 }}>
                            {buyer.line_nick&&<span>Line: {buyer.line_nick}</span>}
                            {buyer.fb_name&&<span>FB: {buyer.fb_name}</span>}
                          </div>
                        </div>
                      </div>
                      <div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' }}>
                        {buyer.pendingCnt>0 && <span className="badge badge-amber">待出貨 {buyer.pendingCnt} 筆</span>}
                        {buyer.shippedCnt>0 && <span className="badge badge-emerald">已出貨 {buyer.shippedCnt} 筆</span>}
                        {buyer.unpaidCnt>0  && <span className="badge badge-rose">未收款 NT${buyer.unpaidAmt.toLocaleString()}</span>}
                        <span style={{ fontWeight:800,fontSize:15,color:'var(--indigo)' }}>合計 NT${buyerTotal.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* 訂單明細 */}
                    <table style={{ width:'100%',fontSize:13,borderCollapse:'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ padding:'7px 14px',textAlign:'left',fontSize:11,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:'var(--text-secondary)',background:'var(--surface-2)',borderBottom:'1px solid var(--border)' }}>日期</th>
                          <th style={{ padding:'7px 10px',fontSize:11,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:'var(--text-secondary)',background:'var(--surface-2)',borderBottom:'1px solid var(--border)' }}>商品</th>
                          <th style={{ padding:'7px 10px',textAlign:'center',fontSize:11,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:'var(--text-secondary)',background:'var(--surface-2)',borderBottom:'1px solid var(--border)' }}>出貨</th>
                          <th style={{ padding:'7px 10px',textAlign:'center',fontSize:11,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:'var(--text-secondary)',background:'var(--surface-2)',borderBottom:'1px solid var(--border)' }}>收款</th>
                          <th style={{ padding:'7px 14px',textAlign:'right',fontSize:11,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:'var(--text-secondary)',background:'var(--surface-2)',borderBottom:'1px solid var(--border)' }}>金額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {buyerOrders.map(o=>(
                          <tr key={o.id} style={{ borderBottom:'1px solid var(--border)' }}>
                            <td style={{ padding:'8px 14px',color:'var(--text-secondary)',whiteSpace:'nowrap' }}>
                              {o.order_date ? new Date(o.order_date).toLocaleDateString('zh-TW') : '—'}
                            </td>
                            <td style={{ padding:'8px 10px' }}>
                              {(o.items||[]).map((item,i)=>(
                                <div key={i} style={{ fontSize:13 }}>
                                  {item.name}{specLabel(item)}×{item.qty}
                                  {item.note && <span style={{ color:'var(--rose)',fontSize:11 }}> ({item.note})</span>}
                                </div>
                              ))}
                              {o.note && <div style={{ fontSize:11,color:'var(--text-muted)',marginTop:2 }}>備註：{o.note}</div>}
                            </td>
                            <td style={{ padding:'8px 10px',textAlign:'center' }}>
                              <span className={`badge ${o.status==='shipped'?'badge-emerald':o.status==='cancelled'?'badge-rose':'badge-amber'}`}>
                                {o.status==='shipped'?'已出貨':o.status==='cancelled'?'已取消':'待出貨'}
                              </span>
                            </td>
                            <td style={{ padding:'8px 10px',textAlign:'center' }}>
                              <span className={`badge ${o.payment_status==='paid'?'badge-emerald':'badge-rose'}`}>
                                {o.payment_status==='paid'?'已收款':'未收款'}
                              </span>
                            </td>
                            <td style={{ padding:'8px 14px',textAlign:'right',fontWeight:700,color:'var(--indigo)' }}>
                              NT${(o.total_amount||0).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
