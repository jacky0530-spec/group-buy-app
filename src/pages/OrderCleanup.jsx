import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckSquare2, Clock3, RefreshCw, Square, Trash2 } from 'lucide-react'
import { Modal, useToast } from '../components/UI'
import { neonOrderStatusRuntime } from '../lib/neonOrderStatusRuntime'

const MAX_DELETE=400
const MIN_DAYS=14
const MAX_DAYS=3650
const DEFAULT_DAYS=60
const money=value=>`NT$${Math.round(Number(value||0)).toLocaleString()}`
const dateText=value=>value?new Date(value).toLocaleDateString('zh-TW'):'—'

export default function OrderCleanup(){
  const toast=useToast()
  const [days,setDays]=useState(DEFAULT_DAYS)
  const [customDays,setCustomDays]=useState('')
  const [rows,setRows]=useState([])
  const [totalCount,setTotalCount]=useState(0)
  const [loading,setLoading]=useState(true)
  const [selected,setSelected]=useState([])
  const [confirmOpen,setConfirmOpen]=useState(false)
  const [confirmText,setConfirmText]=useState('')
  const [deleting,setDeleting]=useState(false)

  const load=useCallback(async()=>{
    setLoading(true);setSelected([])
    try{
      const result=(await neonOrderStatusRuntime('cleanup_candidates',{days}))?.result||{}
      setRows(Array.isArray(result.rows)?result.rows:[])
      setTotalCount(Number(result.totalCount||0))
    }catch(err){toast('歷史訂單載入失敗：'+err.message,'error')}
    finally{setLoading(false)}
  },[days,toast])
  useEffect(()=>{void load()},[load])

  const selectedRows=useMemo(()=>rows.filter(row=>selected.includes(row.id)),[rows,selected])
  const impact=useMemo(()=>{
    const months=new Map();let revenue=0,cost=0,profit=0,refund=0,supplierOutstanding=0,helperCount=0
    selectedRows.forEach(row=>{
      const key=row.report_month||'未知月份'
      if(!months.has(key))months.set(key,{month:key,count:0,revenue:0,cost:0,profit:0,refund:0})
      const m=months.get(key);m.count+=1;m.revenue+=Number(row.revenue||0);m.cost+=Number(row.cost||0);m.profit+=Number(row.profit||0);m.refund+=Number(row.refund||0)
      revenue+=Number(row.revenue||0);cost+=Number(row.cost||0);profit+=Number(row.profit||0);refund+=Number(row.refund||0);supplierOutstanding+=Number(row.supplier_outstanding||0)
      if(row.source==='helper')helperCount+=1
    })
    return{months:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)),revenue,cost,profit,refund,supplierOutstanding,helperCount}
  },[selectedRows])

  const totalRevenue=useMemo(()=>rows.reduce((sum,row)=>sum+Number(row.revenue||0),0),[rows])
  const allSelected=rows.length>0&&selected.length===rows.length
  function toggle(id){setSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])}
  function toggleAll(){setSelected(allSelected?[]:rows.map(row=>row.id))}
  function chooseDays(value){setDays(value);setCustomDays('')}
  function applyCustomDays(){
    const value=Math.trunc(Number(customDays))
    if(!Number.isFinite(value)||value<MIN_DAYS||value>MAX_DAYS){toast(`自訂天數需介於 ${MIN_DAYS}～${MAX_DAYS} 天`,'warning');return}
    setDays(value)
  }
  function openImpact(){if(!selectedRows.length){toast('請先勾選要刪除的歷史訂單','warning');return}setConfirmText('');setConfirmOpen(true)}
  async function confirmDelete(){
    if(confirmText!=='永久刪除'||deleting)return
    setDeleting(true)
    try{
      const result=(await neonOrderStatusRuntime('cleanup_delete',{ids:selectedRows.map(row=>row.id),days}))?.result||{}
      toast(`已永久刪除 ${Number(result.deleted||0)} 筆歷史訂單`,'warning')
      setConfirmOpen(false);setConfirmText('');await load()
    }catch(err){toast('歷史訂單刪除失敗：'+err.message,'error')}
    finally{setDeleting(false)}
  }

  return <div className="animate-fade">
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginBottom:18}}>
      <div><h2 style={{fontSize:22,fontWeight:800}}>歷史訂單清理</h2><p style={{color:'var(--text-secondary)',fontSize:13,marginTop:3}}>預設查詢已完整出貨超過 60 天的正式預購訂單；現貨與虛擬訂單自動排除。</p></div>
      <button className="btn btn-ghost" onClick={load} disabled={loading}><RefreshCw size={14}/>{loading?'讀取中...':'重新整理'}</button>
    </div>

    <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:12,padding:14,marginBottom:16,color:'#9a3412',fontSize:13,lineHeight:1.7}}>
      <strong><AlertTriangle size={15} style={{verticalAlign:'-2px'}}/> 永久刪除會影響財務報表</strong><br/>目前銷售／財務報表直接由訂單與訂單明細 SQL 計算，因此刪除後對應月份的營收、成本、毛利與退款會同步減少。系統會在最後確認前列出受影響月份與金額。
    </div>

    <div className="card" style={{marginBottom:16}}><div className="card-body" style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
      <Clock3 size={17}/><strong>篩選已出貨超過</strong>
      <button className={`btn btn-sm ${days===14?'btn-primary':'btn-ghost'}`} onClick={()=>chooseDays(14)}>14 天</button>
      <button className={`btn btn-sm ${days===30?'btn-primary':'btn-ghost'}`} onClick={()=>chooseDays(30)}>30 天</button>
      <button className={`btn btn-sm ${days===60?'btn-primary':'btn-ghost'}`} onClick={()=>chooseDays(60)}>60 天（預設）</button>
      <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
        <input type="number" min={MIN_DAYS} max={MAX_DAYS} step="1" value={customDays} onChange={e=>setCustomDays(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')applyCustomDays()}} placeholder="其他天數" style={{width:105,padding:'7px 9px'}}/>
        <button className="btn btn-sm btn-ghost" onClick={applyCustomDays} disabled={!customDays}>套用</button>
      </div>
      <span style={{fontSize:12,color:'var(--text-muted)'}}>目前：{days} 天以上｜依 shipped_at 判斷</span>
    </div></div>

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:16}}>
      <div style={{background:'var(--indigo-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,fontWeight:800,color:'var(--indigo)'}}>符合 {days} 天以上</div><strong style={{fontSize:22,color:'var(--indigo)'}}>{totalCount} 筆</strong>{totalCount>MAX_DELETE&&<div style={{fontSize:11,color:'var(--text-muted)'}}>本次先顯示最舊 {MAX_DELETE} 筆</div>}</div>
      <div style={{background:'var(--emerald-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,fontWeight:800,color:'var(--emerald)'}}>目前顯示報表營收</div><strong style={{fontSize:22,color:'var(--emerald)'}}>{money(totalRevenue)}</strong></div>
      <div style={{background:'var(--amber-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,fontWeight:800,color:'#b45309'}}>已勾選</div><strong style={{fontSize:22,color:'#b45309'}}>{selected.length} 筆</strong></div>
    </div>

    <div className="card"><div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}><button className="btn btn-ghost btn-sm" onClick={toggleAll} disabled={loading||!rows.length}>{allSelected?<CheckSquare2 size={14}/>:<Square size={14}/>} 全選</button><span style={{fontSize:12,color:'var(--text-muted)'}}>單次最多 {MAX_DELETE} 筆</span></div>
      <button className="btn btn-sm" style={{background:'var(--rose)',color:'#fff',borderColor:'var(--rose)'}} disabled={!selected.length||deleting} onClick={openImpact}><Trash2 size={14}/>檢查影響並刪除 {selected.length||''}</button>
    </div><div className="table-container"><table><thead><tr><th></th><th>客戶</th><th>報表月份</th><th>出貨日</th><th>營收</th><th>成本</th><th>退款</th><th>供應商狀態</th><th>來源</th></tr></thead><tbody>
      {loading&&<tr><td colSpan={9} style={{textAlign:'center',padding:34}}>Neon SQL 查詢中...</td></tr>}
      {!loading&&!rows.length&&<tr><td colSpan={9} style={{textAlign:'center',padding:34,color:'var(--text-muted)'}}>目前沒有符合 {days} 天以上條件的歷史訂單</td></tr>}
      {!loading&&rows.map(row=><tr key={row.id} style={{opacity:row.archived?.68:1}}><td><input type="checkbox" checked={selected.includes(row.id)} onChange={()=>toggle(row.id)}/></td><td><strong>{row.customer_name||'未命名客戶'}</strong>{row.archived&&<span className="badge badge-gray" style={{marginLeft:5}}>已封存</span>}<div style={{fontSize:11,color:'var(--text-muted)'}}>{row.item_count} 品項／{row.qty} 件</div></td><td>{row.report_month||'—'}</td><td>{dateText(row.shipped_at)}</td><td style={{fontWeight:800}}>{money(row.revenue)}</td><td>{money(row.cost)}</td><td>{Number(row.refund||0)>0?<span style={{color:'var(--rose)',fontWeight:800}}>{money(row.refund)}</span>:'—'}</td><td>{Number(row.supplier_outstanding||0)>0.01?<span className="badge badge-rose">尚欠 {money(row.supplier_outstanding)}</span>:<span className="badge badge-emerald">已結清</span>}</td><td>{row.source==='helper'?<span className="badge badge-violet">小幫手</span>:<span className="badge badge-gray">後台</span>}</td></tr>)}
    </tbody></table></div></div>

    {confirmOpen&&<Modal title={`永久刪除前影響確認｜${selectedRows.length} 筆`} width={820} onClose={()=>!deleting&&setConfirmOpen(false)}>
      <div style={{background:'#fff1f2',border:'1px solid #fecdd3',borderRadius:10,padding:14,color:'#9f1239',lineHeight:1.65,marginBottom:14}}><strong>刪除後無法復原。</strong><br/>目前篩選為已出貨超過 {days} 天。只刪除訂單及其必要關聯明細；客戶、商品、供應商付款主紀錄與小幫手登記歷史不會刪除。小幫手訂單連結及供應商付款分配連結會解除。</div>
      <div className="table-container" style={{marginBottom:14}}><table><thead><tr><th>影響月份</th><th>訂單</th><th>營收減少</th><th>成本減少</th><th>毛利影響</th><th>退款減少</th></tr></thead><tbody>{impact.months.map(row=><tr key={row.month}><td><strong>{row.month}</strong></td><td>{row.count}</td><td>{money(row.revenue)}</td><td>{money(row.cost)}</td><td>{money(row.profit)}</td><td>{money(row.refund)}</td></tr>)}</tbody></table></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10,marginBottom:14}}><div style={{background:'var(--emerald-light)',borderRadius:8,padding:10}}><small>營收影響</small><div style={{fontWeight:900}}>{money(impact.revenue)}</div></div><div style={{background:'var(--amber-light)',borderRadius:8,padding:10}}><small>成本影響</small><div style={{fontWeight:900}}>{money(impact.cost)}</div></div><div style={{background:'var(--rose-light)',borderRadius:8,padding:10}}><small>供應商尚欠</small><div style={{fontWeight:900}}>{money(impact.supplierOutstanding)}</div></div><div style={{background:'var(--indigo-light)',borderRadius:8,padding:10}}><small>小幫手來源</small><div style={{fontWeight:900}}>{impact.helperCount} 筆</div></div></div>
      {impact.supplierOutstanding>0.01&&<div style={{background:'#fffbeb',border:'1px solid #fde68a',padding:11,borderRadius:8,color:'#92400e',marginBottom:14}}>⚠️ 選取訂單仍有供應商未付款 {money(impact.supplierOutstanding)}；刪除後相關應付成本也會從訂單型報表消失。</div>}
      <label style={{display:'block',fontWeight:800,marginBottom:6}}>確認後請輸入「永久刪除」</label><input value={confirmText} onChange={e=>setConfirmText(e.target.value)} placeholder="永久刪除" disabled={deleting} style={{width:'100%',padding:'10px 12px',marginBottom:14}}/><div style={{display:'flex',justifyContent:'flex-end',gap:8}}><button className="btn btn-ghost" disabled={deleting} onClick={()=>setConfirmOpen(false)}>取消</button><button className="btn btn-danger" disabled={deleting||confirmText!=='永久刪除'} onClick={confirmDelete}><Trash2 size={14}/>{deleting?'刪除中...':`永久刪除 ${selectedRows.length} 筆`}</button></div>
    </Modal>}
  </div>
}
