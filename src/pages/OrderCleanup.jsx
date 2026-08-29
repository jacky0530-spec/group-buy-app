import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckSquare2, Clock3, RefreshCw, Square, Trash2 } from 'lucide-react'
import { OrdersAPI } from '../lib/db'
import { Modal, useToast } from '../components/UI'

const PAGE_SIZE = 250
const MAX_DELETE = 400
const money = value => `NT$${Math.round(Number(value || 0)).toLocaleString()}`
const dateText = value => value ? new Date(value).toLocaleDateString('zh-TW') : '—'

function taipeiDateKey(value) {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',
    }).format(new Date(value))
  } catch {
    return String(value).slice(0,10)
  }
}
function monthKey(value) {
  const key = taipeiDateKey(value)
  return key ? key.slice(0,7) : '未知月份'
}
function orderMetrics(order) {
  const gross = Number(order.total_amount || 0)
  const refund = Number(order.refund_amount || 0)
  const revenue = Math.max(0,gross-refund)
  let cost = 0
  let supplierPaid = 0
  let qty = 0
  for (const item of order.items || []) {
    const lineQty = Math.max(0,Number(item.qty || 0))
    const lineCost = Math.max(0,Number(item.cost_price || 0) * lineQty)
    cost += lineCost
    qty += lineQty
    supplierPaid += Math.min(lineCost,Math.max(0,Number(item.supplier_paid_amount || 0)))
  }
  return {
    gross,refund,revenue,cost,profit:revenue-cost,qty,
    supplierPaid,supplierOutstanding:Math.max(0,cost-supplierPaid),
  }
}
async function fetchAllOldShipped(days) {
  const cutoff = new Date(Date.now() - Number(days || 14) * 86400000)
  const dateTo = taipeiDateKey(cutoff)
  const rows = []
  let cursor = null
  let guard = 0
  do {
    const page = await OrdersAPI.searchPage({
      status:'shipped',includeArchived:true,dateTo,pageSize:PAGE_SIZE,cursor,
    })
    rows.push(...(page.rows || []))
    cursor = page.hasMore ? page.nextCursor : null
    guard += 1
  } while (cursor && guard < 100)

  return rows
    .filter(order => {
      if (order.status !== 'shipped') return false
      if (order.is_virtual === true) return false
      if (String(order.fulfillment_type || 'preorder') === 'stock') return false
      const shipped = Date.parse(order.shipped_at || '')
      if (!Number.isFinite(shipped) || shipped > cutoff.getTime()) return false
      return (order.items || []).some(item => Number(item.qty || 0) > 0)
    })
    .map(order => ({...order,...orderMetrics(order),report_month:monthKey(order.order_date)}))
    .sort((a,b) => Date.parse(a.shipped_at || 0) - Date.parse(b.shipped_at || 0))
}

export default function OrderCleanup() {
  const toast = useToast()
  const [days,setDays] = useState(14)
  const [rows,setRows] = useState([])
  const [loading,setLoading] = useState(true)
  const [deleting,setDeleting] = useState(false)
  const [selected,setSelected] = useState([])
  const [confirmOpen,setConfirmOpen] = useState(false)
  const [confirmText,setConfirmText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setSelected([])
    try {
      const result = await fetchAllOldShipped(days)
      setRows(result)
    } catch (err) {
      toast('歷史訂單載入失敗：'+err.message,'error')
    } finally {
      setLoading(false)
    }
  },[days,toast])

  useEffect(() => { void load() },[load])

  const selectedRows = useMemo(() => rows.filter(row => selected.includes(row.id)),[rows,selected])
  const impact = useMemo(() => {
    const map = new Map()
    let revenue=0,cost=0,profit=0,refund=0,supplierOutstanding=0,helperCount=0
    for (const row of selectedRows) {
      const month = row.report_month || '未知月份'
      if (!map.has(month)) map.set(month,{month,count:0,revenue:0,cost:0,profit:0,refund:0})
      const m = map.get(month)
      m.count += 1
      m.revenue += row.revenue
      m.cost += row.cost
      m.profit += row.profit
      m.refund += row.refund
      revenue += row.revenue; cost += row.cost; profit += row.profit; refund += row.refund
      supplierOutstanding += row.supplierOutstanding
      if (row.source === 'helper') helperCount += 1
    }
    return {
      months:[...map.values()].sort((a,b)=>a.month.localeCompare(b.month)),
      revenue,cost,profit,refund,supplierOutstanding,helperCount,
    }
  },[selectedRows])

  function toggle(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev,id])
  }
  function toggleAll() {
    if (!rows.length) return
    if (selected.length === rows.length) { setSelected([]); return }
    if (rows.length > MAX_DELETE) {
      setSelected(rows.slice(0,MAX_DELETE).map(row=>row.id))
      toast(`單次最多永久刪除 ${MAX_DELETE} 筆，已先選前 ${MAX_DELETE} 筆`,'warning')
      return
    }
    setSelected(rows.map(row=>row.id))
  }
  function openImpact() {
    if (!selectedRows.length) { toast('請先勾選要刪除的歷史訂單','warning'); return }
    if (selectedRows.length > MAX_DELETE) { toast(`單次最多刪除 ${MAX_DELETE} 筆`,'warning'); return }
    setConfirmText('')
    setConfirmOpen(true)
  }
  async function confirmDelete() {
    if (confirmText !== '永久刪除') return
    setDeleting(true)
    try {
      const result = await OrdersAPI.bulkHardDelete(selectedRows.map(row=>row.id))
      toast(`已永久刪除 ${Number(result?.deleted || 0)} 筆歷史訂單`,'warning')
      setConfirmOpen(false)
      setConfirmText('')
      await load()
    } catch (err) {
      toast('歷史訂單刪除失敗：'+err.message,'error')
    } finally {
      setDeleting(false)
    }
  }

  const total = useMemo(() => rows.reduce((sum,row)=>sum+row.revenue,0),[rows])

  return <div className="animate-fade">
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginBottom:18}}>
      <div>
        <h2 style={{fontSize:22,fontWeight:800}}>歷史訂單清理</h2>
        <p style={{color:'var(--text-secondary)',fontSize:13,marginTop:3}}>僅列正式預購、已出貨且超過指定時間的訂單。現貨與虛擬訂單不會列入。</p>
      </div>
      <button className="btn btn-ghost" onClick={load} disabled={loading}><RefreshCw size={14}/>{loading?'讀取中...':'重新整理'}</button>
    </div>

    <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:12,padding:14,marginBottom:16,color:'#9a3412',fontSize:13,lineHeight:1.7}}>
      <strong><AlertTriangle size={15} style={{verticalAlign:'-2px'}}/> 刪除會影響財務報表</strong><br/>
      財務報表目前直接由 orders / order_items 計算，所以永久刪除後，該月份的營收、成本、毛利與退款都會同步減少。第11版先採「刪除前顯示影響月份與金額」；若未來要刪除訂單但保留報表，需另建財務快照資料表。
    </div>

    <div className="card" style={{marginBottom:16}}>
      <div className="card-body" style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <Clock3 size={17}/><strong>篩選已出貨超過</strong>
        <button className={`btn btn-sm ${days===14?'btn-primary':'btn-ghost'}`} onClick={()=>setDays(14)}>14 天（兩週）</button>
        <button className={`btn btn-sm ${days===30?'btn-primary':'btn-ghost'}`} onClick={()=>setDays(30)}>30 天（一個月）</button>
        <span style={{color:'var(--text-muted)',fontSize:12}}>依實際 shipped_at 判斷</span>
      </div>
    </div>

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:16}}>
      <div style={{background:'var(--indigo-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,color:'var(--indigo)',fontWeight:800}}>符合清理條件</div><strong style={{fontSize:22,color:'var(--indigo)'}}>{rows.length} 筆</strong></div>
      <div style={{background:'var(--emerald-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,color:'var(--emerald)',fontWeight:800}}>這批歷史報表營收</div><strong style={{fontSize:22,color:'var(--emerald)'}}>{money(total)}</strong></div>
      <div style={{background:'var(--amber-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,color:'#b45309',fontWeight:800}}>已勾選</div><strong style={{fontSize:22,color:'#b45309'}}>{selected.length} 筆</strong></div>
    </div>

    <div className="card">
      <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button className="btn btn-ghost btn-sm" onClick={toggleAll} disabled={loading||!rows.length}>
            {selected.length && selected.length===Math.min(rows.length,MAX_DELETE)?<CheckSquare2 size={14}/>:<Square size={14}/>} 全選
          </button>
          <span style={{fontSize:12,color:'var(--text-muted)'}}>單次最多 {MAX_DELETE} 筆</span>
        </div>
        <button className="btn btn-sm" style={{background:'var(--rose)',color:'#fff',borderColor:'var(--rose)'}} disabled={!selected.length||deleting} onClick={openImpact}><Trash2 size={14}/>檢查影響並刪除 {selected.length||''}</button>
      </div>
      <div className="table-container">
        <table>
          <thead><tr><th></th><th>客戶</th><th>報表月份</th><th>出貨日</th><th>營收</th><th>成本</th><th>退款</th><th>供應商狀態</th><th>來源</th></tr></thead>
          <tbody>
            {loading&&<tr><td colSpan={9} style={{textAlign:'center',padding:34}}>Neon SQL 讀取中...</td></tr>}
            {!loading&&!rows.length&&<tr><td colSpan={9} style={{textAlign:'center',padding:34,color:'var(--text-muted)'}}>目前沒有符合條件的歷史訂單</td></tr>}
            {!loading&&rows.map(row=><tr key={row.id} style={{opacity:row.archived?.68:1}}>
              <td><input type="checkbox" checked={selected.includes(row.id)} onChange={()=>toggle(row.id)}/></td>
              <td><strong>{row.customer_name||'未命名客戶'}</strong>{row.archived&&<span className="badge badge-gray" style={{marginLeft:5}}>已封存</span>}<div style={{fontSize:11,color:'var(--text-muted)'}}>{row.items?.length||0} 品項／{row.qty} 件</div></td>
              <td>{row.report_month}</td>
              <td>{dateText(row.shipped_at)}</td>
              <td style={{fontWeight:800}}>{money(row.revenue)}</td>
              <td>{money(row.cost)}</td>
              <td>{row.refund>0?<span style={{color:'var(--rose)',fontWeight:800}}>{money(row.refund)}</span>:'—'}</td>
              <td>{row.supplierOutstanding>0.01?<span className="badge badge-rose">尚欠 {money(row.supplierOutstanding)}</span>:<span className="badge badge-emerald">已結清</span>}</td>
              <td>{row.source==='helper'?<span className="badge badge-violet">小幫手</span>:<span className="badge badge-gray">後台</span>}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>

    {confirmOpen&&<Modal title={`永久刪除前影響確認｜${selectedRows.length} 筆`} width={820} onClose={()=>!deleting&&setConfirmOpen(false)}>
      <div style={{background:'#fff1f2',border:'1px solid #fecdd3',borderRadius:10,padding:14,color:'#9f1239',lineHeight:1.65,marginBottom:14}}>
        <strong>這不是封存，刪除後無法復原。</strong><br/>
        下列月份的財務報表會永久減少。小幫手登記歷史會保留，但訂單連結會解除；供應商付款主紀錄保留，相關訂單分配連結會被清除。
      </div>
      <div className="table-container" style={{marginBottom:14}}><table><thead><tr><th>影響月份</th><th>訂單</th><th>營收減少</th><th>成本減少</th><th>毛利變化</th><th>退款紀錄減少</th></tr></thead><tbody>{impact.months.map(row=><tr key={row.month}><td><strong>{row.month}</strong></td><td>{row.count}</td><td>{money(row.revenue)}</td><td>{money(row.cost)}</td><td>{money(row.profit)}</td><td>{money(row.refund)}</td></tr>)}</tbody></table></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10,marginBottom:14}}>
        <div style={{background:'var(--emerald-light)',borderRadius:8,padding:10}}><small>營收影響</small><div style={{fontWeight:900}}>{money(impact.revenue)}</div></div>
        <div style={{background:'var(--amber-light)',borderRadius:8,padding:10}}><small>成本影響</small><div style={{fontWeight:900}}>{money(impact.cost)}</div></div>
        <div style={{background:'var(--rose-light)',borderRadius:8,padding:10}}><small>供應商尚欠</small><div style={{fontWeight:900,color:impact.supplierOutstanding>0?'var(--rose)':'inherit'}}>{money(impact.supplierOutstanding)}</div></div>
        <div style={{background:'var(--indigo-light)',borderRadius:8,padding:10}}><small>小幫手來源</small><div style={{fontWeight:900}}>{impact.helperCount} 筆</div></div>
      </div>
      {impact.supplierOutstanding>0.01&&<div style={{background:'#fffbeb',border:'1px solid #fde68a',padding:11,borderRadius:8,color:'#92400e',marginBottom:14}}>⚠️ 選取訂單仍有供應商未付款金額 {money(impact.supplierOutstanding)}。永久刪除後，這些應付成本也會從報表中消失。</div>}
      <label style={{display:'block',fontWeight:800,marginBottom:6}}>若確定刪除，請輸入「永久刪除」</label>
      <input value={confirmText} onChange={e=>setConfirmText(e.target.value)} placeholder="永久刪除" disabled={deleting} style={{width:'100%',padding:'10px 12px',marginBottom:14}}/>
      <div style={{display:'flex',justifyContent:'flex-end',gap:8}}><button className="btn btn-ghost" disabled={deleting} onClick={()=>setConfirmOpen(false)}>取消</button><button className="btn btn-danger" disabled={deleting||confirmText!=='永久刪除'} onClick={confirmDelete}><Trash2 size={14}/>{deleting?'刪除中...':`永久刪除 ${selectedRows.length} 筆`}</button></div>
    </Modal>}
  </div>
}
