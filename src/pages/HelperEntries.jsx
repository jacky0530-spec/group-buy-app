import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Database, Search, CalendarDays } from 'lucide-react'
import { useToast } from '../components/UI'
import { HelperAPI } from '../lib/helper'
import { ProductsAPI } from '../lib/db'
import { neonHelperAdminRuntime } from '../lib/neonRuntime'

const money = v => `NT$${Math.round(Number(v || 0)).toLocaleString()}`
const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}
const statusLabel = status => status === 'converted' ? '已建立訂單' : status === 'cancelled' ? '已取消' : '舊待確認'
const PAGE_SIZE=100

export default function HelperEntries() {
  const toast = useToast()
  const [entries,setEntries] = useState([])
  const [stats,setStats] = useState([])
  const [totalCount,setTotalCount] = useState(0)
  const [hasMore,setHasMore] = useState(false)
  const [loading,setLoading] = useState(true)
  const [loadingMore,setLoadingMore] = useState(false)
  const [working,setWorking] = useState('')
  const [month,setMonth] = useState(currentMonth())
  const [search,setSearch] = useState('')

  const queryDashboard = useCallback(async ({append=false}={}) => {
    const offset=append?entries.length:0
    append?setLoadingMore(true):setLoading(true)
    try {
      const result=await neonHelperAdminRuntime({action:'dashboard',month,search:search.trim(),pageSize:PAGE_SIZE,offset})
      const rows=Array.isArray(result?.rows)?result.rows:[]
      setEntries(prev=>append?[...prev,...rows]:rows)
      setStats(Array.isArray(result?.stats)?result.stats:[])
      setTotalCount(Number(result?.totalCount||0))
      setHasMore(result?.hasMore===true)
    } catch (err) {
      toast('載入失敗：'+err.message,'error')
    } finally {
      append?setLoadingMore(false):setLoading(false)
    }
  },[month,search,entries.length,toast])

  useEffect(() => {
    const timer=window.setTimeout(()=>queryDashboard({append:false}),search.trim()?280:0)
    return ()=>window.clearTimeout(timer)
  },[month,search])

  async function sync() {
    setWorking('sync')
    try {
      const products=await ProductsAPI.list({includeArchived:true})
      const n = await HelperAPI.syncCatalog(products)
      toast(`已同步 ${n} 筆小幫手商品目錄 ✓`)
    } catch (err) {
      toast('同步失敗：'+err.message,'error')
    } finally {
      setWorking('')
    }
  }

  const totals = useMemo(() => stats.reduce((a,r) => ({
    total:a.total+Number(r.total||0),
    converted:a.converted+Number(r.converted||0),
    pending:a.pending+Number(r.pending||0),
    cancelled:a.cancelled+Number(r.cancelled||0),
    virtual:a.virtual+Number(r.virtual||0),
    formal:a.formal+Number(r.formal||0),
    payUnits:a.payUnits+Number(r.pay_units||0),
  }),{total:0,converted:0,pending:0,cancelled:0,virtual:0,formal:0,payUnits:0}),[stats])

  return <div className="animate-fade">
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:18}}>
      <div>
        <h2 style={{fontSize:22,fontWeight:800}}>小幫手登記</h2>
        <p style={{fontSize:13,color:'var(--text-secondary)',marginTop:3}}>月份統計與紀錄搜尋已改由 Neon SQL 執行；每次只載入目前月份與最多 {PAGE_SIZE} 筆紀錄。</p>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button className="btn btn-ghost" onClick={sync} disabled={working==='sync'}><Database size={14}/>{working==='sync'?'同步中...':'重新同步商品目錄'}</button>
        <button className="btn btn-ghost" onClick={()=>queryDashboard({append:false})} disabled={loading}><RefreshCw size={14}/>重新整理</button>
      </div>
    </div>

    <div style={{background:'#ecfdf5',border:'1px solid #a7f3d0',padding:12,borderRadius:10,marginBottom:14,fontSize:13,color:'#065f46'}}>
      薪資計算規則：正式訂單依商品數量計算（例如 ×5 就算 5）；虛擬訂單維持每筆登記算 1。舊待確認與已取消不列入薪資。
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
      <div style={{background:'#eefbf4',borderRadius:10,padding:14}}><div style={{fontSize:12,color:'var(--text-secondary)',fontWeight:700}}>正式商品數量</div><strong style={{fontSize:26,color:'#047857'}}>{totals.formal}</strong></div>
      <div style={{background:'#fff1f2',borderRadius:10,padding:14}}><div style={{fontSize:12,color:'var(--text-secondary)',fontWeight:700}}>虛擬薪資筆數</div><strong style={{fontSize:26,color:'#be123c'}}>{totals.virtual}</strong></div>
      <div style={{background:'#f5f3ff',borderRadius:10,padding:14}}><div style={{fontSize:12,color:'var(--text-secondary)',fontWeight:700}}>薪資計算數量</div><strong style={{fontSize:26,color:'#6d28d9'}}>{totals.payUnits}</strong><div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>目前 1 單位 = NT$1</div></div>
      <div style={{background:'var(--amber-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,color:'var(--text-secondary)',fontWeight:700}}>舊待確認</div><strong style={{fontSize:26,color:'#b45309'}}>{totals.pending}</strong></div>
    </div>

    <div className="card" style={{marginBottom:14}}>
      <div className="card-header"><strong>{month || '全部月份'} 小幫手薪資統計</strong></div>
      <div className="table-container"><table>
        <thead><tr><th>小幫手</th><th>登記筆數</th><th>已建立訂單</th><th>正式數量</th><th>虛擬筆數</th><th>薪資數量</th><th>薪資</th><th>舊待確認</th><th>已取消</th><th>成功率</th></tr></thead>
        <tbody>
          {stats.map(r => <tr key={r.key}><td><strong>{r.name}</strong>{r.uid&&<div style={{fontSize:10,color:'var(--text-muted)'}}>UID {r.uid.slice(0,8)}…</div>}</td><td><strong>{r.total}</strong></td><td><strong style={{color:'var(--emerald)'}}>{r.converted}</strong></td><td><strong>{r.formal}</strong></td><td>{r.virtual}</td><td><strong style={{color:'#6d28d9'}}>{r.pay_units}</strong></td><td><strong>{money(r.pay_units)}</strong></td><td>{r.pending}</td><td>{r.cancelled}</td><td>{r.total?`${Math.round(Number(r.converted||0)/Number(r.total||1)*100)}%`:'—'}</td></tr>)}
          {!loading&&!stats.length&&<tr><td colSpan={10} style={{textAlign:'center',padding:28,color:'var(--text-muted)'}}>此月份沒有小幫手登記資料</td></tr>}
        </tbody>
      </table></div>
    </div>

    <div className="card">
      <div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap'}}><strong>登記紀錄 {totalCount} 筆</strong><span style={{fontSize:11,color:'var(--text-muted)'}}>目前載入 {entries.length} 筆</span></div>
      <div className="table-container"><table>
        <thead><tr><th>時間</th><th>登記人</th><th>客戶</th><th>商品明細</th><th>類型</th><th>金額</th><th>狀態</th></tr></thead>
        <tbody>
          {loading&&<tr><td colSpan={7} style={{textAlign:'center',padding:30}}>讀取中...</td></tr>}
          {!loading&&entries.map(e => <tr key={e.id} style={{background:e.is_virtual?'#fff1f2':undefined}}>
            <td style={{whiteSpace:'nowrap'}}>{e.created_at ? new Date(e.created_at).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}</td>
            <td>{e.created_by_name||'小幫手'}</td>
            <td><strong>{e.customer_name}</strong>{e.customer_phone_last2&&<div style={{fontSize:11,color:'var(--text-muted)'}}>末碼 {e.customer_phone_last2}</div>}</td>
            <td>{(e.items||[]).map((x,i)=><div key={i}>{x.product_name||x.name} ×<strong>{x.qty}</strong>{x.spec?.package?`／${x.spec.package}`:''}{x.spec?.flavor?`／${x.spec.flavor}`:''}{x.spec?.color?`／${x.spec.color}`:''}{x.spec?.size?`／${x.spec.size}`:''}</div>)}{e.note&&<div style={{fontSize:11,color:'var(--text-muted)'}}>備註：{e.note}</div>}</td>
            <td><span className={`badge ${e.is_virtual?'badge-rose':'badge-emerald'}`}>{e.is_virtual?'⚠ 虛擬':'正式'}</span></td>
            <td>{money(e.total_amount)}</td>
            <td><span className={`badge ${e.status==='converted'?'badge-emerald':e.status==='cancelled'?'badge-gray':'badge-amber'}`}>{statusLabel(e.status)}</span>{e.converted_order_id&&<div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>訂單 {e.converted_order_id.slice(0,8)}…</div>}</td>
          </tr>)}
          {!loading&&!entries.length&&<tr><td colSpan={7} style={{textAlign:'center',padding:30,color:'var(--text-muted)'}}>目前沒有符合條件的紀錄</td></tr>}
        </tbody>
      </table></div>
      {hasMore&&<div style={{padding:12,textAlign:'center',borderTop:'1px solid var(--border)'}}><button className="btn btn-ghost" disabled={loadingMore} onClick={()=>queryDashboard({append:true})}>{loadingMore?'載入中...':`載入更多（尚有 ${Math.max(0,totalCount-entries.length)} 筆）`}</button></div>}
    </div>
  </div>
}
