import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, RefreshCw, Search } from 'lucide-react'
import { neonHelperRuntime } from '../lib/neonRuntime'
import { useToast } from './UI'

const taipeiToday=()=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date())

function deadlineStatus(row,today){
  const deadline=String(row?.order_deadline||'')
  if(!deadline)return{label:'不限結單',className:'badge badge-gray'}
  if(deadline<today)return{label:`已結單 ${deadline}`,className:'badge badge-rose'}
  if(deadline===today)return{label:`今日結單 ${deadline}`,className:'badge badge-amber'}
  return{label:`結單 ${deadline}`,className:'badge badge-indigo'}
}

export default function ProductDeadlineManager(){
  const toast=useToast()
  const[rows,setRows]=useState([])
  const[search,setSearch]=useState('')
  const[drafts,setDrafts]=useState({})
  const[loading,setLoading]=useState(true)
  const[saving,setSaving]=useState('')
  const today=useMemo(()=>taipeiToday(),[])

  const load=useCallback(async()=>{
    setLoading(true)
    try{
      const data=await neonHelperRuntime('product_deadlines',{q:search.trim(),limit:200})
      const next=Array.isArray(data?.rows)?data.rows:[]
      setRows(next)
      setDrafts(Object.fromEntries(next.map(row=>[row.id,String(row.order_deadline||'')])))
    }catch(err){toast('結單日資料載入失敗：'+err.message,'error')}
    finally{setLoading(false)}
  },[search,toast])

  useEffect(()=>{
    const timer=window.setTimeout(load,search.trim()?250:0)
    return()=>window.clearTimeout(timer)
  },[load,search])

  async function save(row){
    const value=String(drafts[row.id]||'')
    setSaving(row.id)
    try{
      const data=await neonHelperRuntime('set_product_deadline',{id:row.id,order_deadline:value})
      const result=data?.result||{}
      setRows(prev=>prev.map(item=>item.id===row.id?{...item,order_deadline:String(result.order_deadline||'')}:item))
      toast(value?`✅ ${row.name} 結單日已設為 ${value}`:`✅ ${row.name} 已改為不限結單`)
    }catch(err){toast('結單日儲存失敗：'+err.message,'error')}
    finally{setSaving('')}
  }

  return <div className="card" style={{marginTop:18,marginBottom:18}}>
    <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
      <div>
        <div style={{display:'flex',alignItems:'center',gap:8,fontWeight:900,fontSize:17}}><CalendarDays size={18}/>商品結單日設定</div>
        <div style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>選填。超過結單日後，小幫手搜尋不到也不能新開單；管理者自行開單不受限制。結單日當天仍可開單。</div>
      </div>
      <button className="btn btn-ghost" onClick={load} disabled={loading}><RefreshCw size={14}/>重新整理</button>
    </div>
    <div className="card-body">
      <div className="search-input-wrap" style={{marginBottom:14}}>
        <Search size={19}/>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋要設定結單日的商品..." style={{height:48,fontSize:16,paddingLeft:42}}/>
      </div>
      {loading?<div className="empty-state" style={{padding:28}}>讀取中...</div>:rows.length===0?<div className="empty-state" style={{padding:28}}>找不到符合的使用中商品</div>:<div style={{display:'grid',gap:8}}>{rows.map(row=>{
        const status=deadlineStatus(row,today)
        const changed=String(drafts[row.id]||'')!==String(row.order_deadline||'')
        return <div key={row.id} style={{display:'grid',gridTemplateColumns:'minmax(180px,1fr) minmax(150px,210px) auto',gap:10,alignItems:'center',padding:'11px 12px',border:'1px solid var(--border)',borderRadius:11,background:'var(--surface)'}}>
          <div><div style={{fontWeight:850}}>{row.name}</div><span className={status.className} style={{marginTop:5}}>{status.label}</span></div>
          <input type="date" value={drafts[row.id]??''} onChange={e=>setDrafts(prev=>({...prev,[row.id]:e.target.value}))} style={{height:48,fontSize:16,minWidth:150}}/>
          <div style={{display:'flex',gap:7,justifyContent:'flex-end',flexWrap:'wrap'}}>
            <button className="btn btn-ghost" disabled={saving===row.id||!String(drafts[row.id]||'')} onClick={()=>setDrafts(prev=>({...prev,[row.id]:''}))}>不限結單</button>
            <button className="btn btn-primary" disabled={saving===row.id||!changed} onClick={()=>save(row)}>{saving===row.id?'儲存中...':'儲存'}</button>
          </div>
        </div>
      })}</div>}
      <div style={{fontSize:11,color:'var(--text-muted)',marginTop:12}}>目前最多顯示 200 項搜尋結果；若商品較多，可直接輸入商品名稱縮小範圍。</div>
    </div>
  </div>
}