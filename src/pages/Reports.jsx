import { useState, useEffect, useCallback } from 'react'
import { OrdersAPI, ProductsAPI } from '../lib/db'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { TrendingUp, DollarSign, Package, Users, Search } from 'lucide-react'

const CAT_COLORS = { daily:'#3b82f6', frozen:'#06b6d4', clothing:'#ec4899', biscuit:'#f59e0b', candy:'#8b5cf6', other:'#6b7280' }
const CAT_LABELS = { daily:'日用品', frozen:'冷凍食品', clothing:'服飾', biscuit:'餅乾', candy:'糖果', other:'其他' }

export default function Reports() {
  const [allOrders,  setAllOrders]  = useState([])
  const [products,   setProducts]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [filterMode, setFilterMode] = useState('all')
  const [inputMonth, setInputMonth] = useState(() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` })
  const [inputStart, setInputStart] = useState('')
  const [inputEnd,   setInputEnd]   = useState('')
  const [trackProd,  setTrackProd]  = useState(null)
  const [prodSearch, setProdSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [ords, prods] = await Promise.all([OrdersAPI.list(), ProductsAPI.list()])
    setAllOrders(ords); setProducts(prods)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // 篩選訂單
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
    const key = filterMode==='all'
      ? `${d.getFullYear()}/${d.getMonth()+1}月`
      : `${d.getMonth()+1}/${d.getDate()}`
    trendMap[key]=(trendMap[key]||0)+(o.total_amount||0)
  })
  const trendData = Object.entries(trendMap).map(([date,amount])=>({date,amount}))

  // 熱銷商品
  const prodSales = {}
  filteredOrders.forEach(o=>(o.items||[]).forEach(item=>{
    if(!prodSales[item.name]) prodSales[item.name]={qty:0,revenue:0}
    prodSales[item.name].qty+=item.qty
    prodSales[item.name].revenue+=item.price*item.qty
  }))
  const topProds = Object.entries(prodSales).sort((a,b)=>b[1].qty-a[1].qty).slice(0,8)
    .map(([name,data])=>({ name:name.length>10?name.slice(0,10)+'…':name, ...data }))

  // 分類佔比
  const catSales = {}
  filteredOrders.forEach(o=>(o.items||[]).forEach(item=>{
    const cat=catMap[item.id]||'other'
    catSales[cat]=(catSales[cat]||0)+item.price*item.qty
  }))
  const catData = Object.entries(catSales).map(([cat,value])=>({ name:CAT_LABELS[cat]||cat, value, color:CAT_COLORS[cat]||'#999' }))

  // 買家追蹤
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

  return (
    <div className="animate-fade">
      <div style={{ marginBottom:20 }}>
        <h2 style={{ fontSize:22,fontWeight:800 }}>銷售報表</h2>
        <p style={{ color:'var(--text-secondary)',fontSize:13,marginTop:2 }}>營收趨勢與商品分析</p>
      </div>

      {/* Filter bar */}
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
        <span style={{ fontSize:13,color:'var(--text-muted)',marginLeft:'auto' }}>共 {filteredOrders.length} 筆訂單</span>
      </div>

      {/* Stat cards */}
      <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:14,marginBottom:20 }}>
        {[
          { label:'總銷售額', value:`NT$${totalRevenue.toLocaleString()}`,  icon:DollarSign, bg:'linear-gradient(135deg,#6366f1,#4338ca)' },
          { label:'預估毛利', value:`NT$${totalProfit.toLocaleString()}`,   icon:TrendingUp, bg:'linear-gradient(135deg,#10b981,#059669)' },
          { label:'訂單數量', value:`${filteredOrders.length} 筆`,          icon:Package,    bg:'linear-gradient(135deg,#f59e0b,#d97706)' },
          { label:'購買客戶', value:`${uniqueCusts} 人`,                    icon:Users,      bg:'linear-gradient(135deg,#0ea5e9,#0284c7)' },
        ].map(s=>(
          <div key={s.label} className="stat-card" style={{ background:s.bg }}>
            <div style={{ fontSize:11,fontWeight:700,letterSpacing:.6,opacity:.8,textTransform:'uppercase',marginBottom:6 }}>{s.label}</div>
            <div style={{ fontSize:22,fontWeight:900,letterSpacing:'-1px',position:'relative',zIndex:1 }}>{loading?'—':s.value}</div>
            <s.icon size={28} style={{ position:'absolute',right:16,top:'50%',transform:'translateY(-50%)',opacity:.22 }}/>
          </div>
        ))}
      </div>

      {/* Charts row */}
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

      {/* Top 8 bar */}
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

      {/* Buyer tracker */}
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
  )
}
