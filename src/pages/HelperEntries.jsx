import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Database, Search, CalendarDays } from 'lucide-react'
import { useToast } from '../components/UI'
import { HelperAPI } from '../lib/helper'
import { ProductsAPI } from '../lib/db'

const money = v => `NT$${Math.round(Number(v || 0)).toLocaleString()}`
const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}
const entryMonth = entry => String(entry.created_at || '').slice(0,7)
const statusLabel = status => status === 'converted' ? '已建立訂單' : status === 'cancelled' ? '已取消' : '舊待確認'

export default function HelperEntries() {
  const toast = useToast()
  const [entries,setEntries] = useState([])
  const [products,setProducts] = useState([])
  const [loading,setLoading] = useState(true)
  const [working,setWorking] = useState('')
  const [month,setMonth] = useState(currentMonth())
  const [search,setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [e,p] = await Promise.all([HelperAPI.allEntries(),ProductsAPI.list({includeArchived:true})])
      setEntries(e)
      setProducts(p)
    } catch (err) {
      toast('載入失敗：'+err.message,'error')
    } finally {
      setLoading(false)
    }
  },[toast])

  useEffect(() => { load() },[load])

  async function sync() {
    setWorking('sync')
    try {
      const n = await HelperAPI.syncCatalog(products)
      toast(`已同步 ${n} 筆小幫手商品目錄 ✓`)
    } catch (err) {
      toast('同步失敗：'+err.message,'error')
    } finally {
      setWorking('')
    }
  }

  const monthEntries = useMemo(
    () => entries.filter(e => !month || entryMonth(e) === month),
    [entries,month],
  )

  const stats = useMemo(() => {
    const map = new Map()
    monthEntries.forEach(e => {
      const key = e.created_by_uid || `name:${e.created_by_name || 'unknown'}`
      if (!map.has(key)) map.set(key,{
        key,
        uid:e.created_by_uid || '',
        name:e.created_by_name || '小幫手',
        total:0,
        converted:0,
        pending:0,
        cancelled:0,
        virtual:0,
        formal:0,
      })
      const row = map.get(key)
      row.total += 1
      if (e.status === 'converted') row.converted += 1
      else if (e.status === 'cancelled') row.cancelled += 1
      else row.pending += 1
      if (e.is_virtual) row.virtual += 1
      else row.formal += 1
    })
    return [...map.values()].sort((a,b) => b.total-a.total || a.name.localeCompare(b.name,'zh-Hant'))
  },[monthEntries])

  const totals = useMemo(() => stats.reduce((a,r) => ({
    total:a.total+r.total,
    converted:a.converted+r.converted,
    pending:a.pending+r.pending,
    cancelled:a.cancelled+r.cancelled,
    virtual:a.virtual+r.virtual,
  }),{total:0,converted:0,pending:0,cancelled:0,virtual:0}),[stats])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return monthEntries
    return monthEntries.filter(e =>
      String(e.created_by_name || '').toLowerCase().includes(q) ||
      String(e.customer_name || '').toLowerCase().includes(q) ||
      String(e.customer_phone_last2 || '').includes(q) ||
      (e.items || []).some(x => String(x.product_name || '').toLowerCase().includes(q))
    )
  },[monthEntries,search])

  return <div className="animate-fade">
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:18}}>
      <div>
        <h2 style={{fontSize:22,fontWeight:800}}>小幫手登記</h2>
        <p style={{fontSize:13,color:'var(--text-secondary)',marginTop:3}}>小幫手送出後直接建立訂單；此頁僅供查詢、稽核與薪資統計，不再需要人工轉單。</p>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button className="btn btn-ghost" onClick={sync} disabled={working==='sync'}><Database size={14}/>{working==='sync'?'同步中...':'重新同步商品目錄'}</button>
        <button className="btn btn-ghost" onClick={load} disabled={loading}><RefreshCw size={14}/>重新整理</button>
      </div>
    </div>

    <div style={{background:'#ecfdf5',border:'1px solid #a7f3d0',padding:12,borderRadius:10,marginBottom:14,fontSize:13,color:'#065f46'}}>
      新版流程會同時寫入正式訂單與小幫手登記紀錄。舊資料若仍顯示「舊待確認」，只保留作歷史紀錄，不再從此頁轉單。
    </div>

    <div className="card" style={{marginBottom:14}}>
      <div className="card-body">
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <label style={{display:'flex',gap:7,alignItems:'center',fontWeight:800}}><CalendarDays size={15}/>統計月份 <input type="month" value={month} onChange={e=>setMonth(e.target.value)} /></label>
          <div className="search-input-wrap" style={{flex:'1 1 280px'}}><Search size={14}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋小幫手、客戶、末兩碼或商品" style={{paddingLeft:32}}/></div>
        </div>
      </div>
    </div>

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:14}}>
      <div style={{background:'var(--indigo-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,color:'var(--text-secondary)',fontWeight:700}}>當月登記筆數</div><strong style={{fontSize:26,color:'var(--indigo)'}}>{totals.total}</strong></div>
      <div style={{background:'var(--emerald-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,color:'var(--text-secondary)',fontWeight:700}}>已建立實際訂單</div><strong style={{fontSize:26,color:'var(--emerald)'}}>{totals.converted}</strong></div>
      <div style={{background:'var(--amber-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,color:'var(--text-secondary)',fontWeight:700}}>舊待確認</div><strong style={{fontSize:26,color:'#b45309'}}>{totals.pending}</strong></div>
      <div style={{background:'#fff1f2',borderRadius:10,padding:14}}><div style={{fontSize:12,color:'var(--text-secondary)',fontWeight:700}}>虛擬訂單</div><strong style={{fontSize:26,color:'#be123c'}}>{totals.virtual}</strong></div>
    </div>

    <div className="card" style={{marginBottom:14}}>
      <div className="card-header"><strong>{month || '全部月份'} 小幫手薪資統計</strong></div>
      <div className="table-container"><table>
        <thead><tr><th>小幫手</th><th>登記筆數</th><th>已建立訂單</th><th>正式</th><th>虛擬</th><th>舊待確認</th><th>已取消</th><th>成功率</th></tr></thead>
        <tbody>
          {stats.map(r => <tr key={r.key}><td><strong>{r.name}</strong>{r.uid&&<div style={{fontSize:10,color:'var(--text-muted)'}}>UID {r.uid.slice(0,8)}…</div>}</td><td><strong>{r.total}</strong></td><td><strong style={{color:'var(--emerald)'}}>{r.converted}</strong></td><td>{r.formal}</td><td>{r.virtual}</td><td>{r.pending}</td><td>{r.cancelled}</td><td>{r.total?`${Math.round(r.converted/r.total*100)}%`:'—'}</td></tr>)}
          {!loading&&!stats.length&&<tr><td colSpan={8} style={{textAlign:'center',padding:28,color:'var(--text-muted)'}}>此月份沒有小幫手登記資料</td></tr>}
        </tbody>
      </table></div>
    </div>

    <div className="card">
      <div className="card-header"><strong>登記紀錄 {visible.length} 筆</strong></div>
      <div className="table-container"><table>
        <thead><tr><th>時間</th><th>登記人</th><th>客戶</th><th>商品明細</th><th>類型</th><th>金額</th><th>狀態</th></tr></thead>
        <tbody>
          {visible.map(e => <tr key={e.id} style={{background:e.is_virtual?'#fff1f2':undefined}}>
            <td style={{whiteSpace:'nowrap'}}>{e.created_at ? new Date(e.created_at).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}</td>
            <td>{e.created_by_name||'小幫手'}</td>
            <td><strong>{e.customer_name}</strong>{e.customer_phone_last2&&<div style={{fontSize:11,color:'var(--text-muted)'}}>末碼 {e.customer_phone_last2}</div>}</td>
            <td>{(e.items||[]).map((x,i)=><div key={i}>{x.product_name} ×<strong>{x.qty}</strong>{x.spec?.package?`／${x.spec.package}`:''}{x.spec?.flavor?`／${x.spec.flavor}`:''}{x.spec?.color?`／${x.spec.color}`:''}{x.spec?.size?`／${x.spec.size}`:''}</div>)}{e.note&&<div style={{fontSize:11,color:'var(--text-muted)'}}>備註：{e.note}</div>}</td>
            <td><span className={`badge ${e.is_virtual?'badge-rose':'badge-emerald'}`}>{e.is_virtual?'⚠ 虛擬':'正式'}</span></td>
            <td>{money(e.total_amount)}</td>
            <td><span className={`badge ${e.status==='converted'?'badge-emerald':e.status==='cancelled'?'badge-gray':'badge-amber'}`}>{statusLabel(e.status)}</span>{e.converted_order_id&&<div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>訂單 {e.converted_order_id.slice(0,8)}…</div>}</td>
          </tr>)}
          {!loading&&!visible.length&&<tr><td colSpan={7} style={{textAlign:'center',padding:30,color:'var(--text-muted)'}}>目前沒有符合條件的紀錄</td></tr>}
        </tbody>
      </table></div>
    </div>
  </div>
}
