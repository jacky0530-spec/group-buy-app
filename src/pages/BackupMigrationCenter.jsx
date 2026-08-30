import { useCallback, useEffect, useMemo, useState } from 'react'
import { Database, Download, RefreshCw, ShieldCheck } from 'lucide-react'
import { useAuth } from '../components/AuthGuard'
import { useToast } from '../components/UI'
import { neonAccountsRuntime } from '../lib/neonRuntime'
import registry from '../migration-registry.json'

const OWNER_EMAIL='jacky0530@gmail.com'
const saveJson=(name,data)=>{
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'})
  const url=URL.createObjectURL(blob)
  const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)
}

export default function BackupMigrationCenter(){
  const { user,role }=useAuth(); const toast=useToast()
  const allowed=role==='owner'&&String(user?.email||'').toLowerCase()===OWNER_EMAIL
  const[loading,setLoading]=useState(false);const[overview,setOverview]=useState(null);const[exporting,setExporting]=useState('')
  const load=useCallback(async()=>{
    if(!allowed)return
    setLoading(true)
    try{const d=await neonAccountsRuntime('backup_overview');setOverview(d.overview||null)}catch(e){toast('備份資訊載入失敗：'+e.message,'error')}finally{setLoading(false)}
  },[allowed,toast])
  useEffect(()=>{load()},[load])
  const tableRows=useMemo(()=>overview?.tables||[],[overview])
  if(!allowed)return <div className="card" style={{padding:24}}><h2>無權限</h2><p>此頁僅開放指定系統擁有者。</p></div>
  const exportTable=async table=>{setExporting(table);try{const d=await neonAccountsRuntime('backup_export_table',{table});saveJson(`group-buy-${table}-${new Date().toISOString().slice(0,10)}.json`,d);toast(`${table} 備份已產生`)}catch(e){toast('匯出失敗：'+e.message,'error')}finally{setExporting('')}}
  const exportAll=async()=>{setExporting('all');try{const bundle={generated_at:new Date().toISOString(),registry,overview,tables:{}};for(const t of overview?.export_tables||[]){const d=await neonAccountsRuntime('backup_export_table',{table:t});bundle.tables[t]=d.rows||[]}saveJson(`group-buy-migration-backup-${new Date().toISOString().slice(0,10)}.json`,bundle);toast('完整移轉 JSON 已產生')}catch(e){toast('完整備份失敗：'+e.message,'error')}finally{setExporting('')}}
  return <div style={{display:'grid',gap:16}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}><div><h1 style={{margin:0}}>🛡️ 系統備份／移轉中心</h1><p style={{margin:'6px 0 0',color:'var(--text-muted)'}}>僅 {OWNER_EMAIL} 可存取。Secret 不會匯出。</p></div><button className="btn btn-ghost" onClick={load} disabled={loading}><RefreshCw size={16}/>重新整理</button></div>
    <div className="card" style={{padding:20}}><div style={{display:'flex',gap:10,alignItems:'center'}}><ShieldCheck size={20}/><strong>Migration Registry 規則</strong></div><p>{registry.policy.rule}</p><p style={{color:'var(--text-muted)',fontSize:13}}>{registry.policy.secret_rule}</p><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{registry.entries.map(e=><span key={e.version} className="badge badge-indigo">{e.version} · {e.summary}</span>)}</div></div>
    <div className="card" style={{padding:20}}><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}><div><strong><Database size={17} style={{verticalAlign:'middle'}}/> PostgreSQL 現況</strong><div style={{fontSize:13,color:'var(--text-muted)',marginTop:4}}>產生時間：{overview?.generated_at||'—'}</div></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn btn-ghost" onClick={()=>saveJson(`group-buy-schema-manifest-${new Date().toISOString().slice(0,10)}.json`,{registry,overview})} disabled={!overview}><Download size={15}/>下載 Schema Manifest</button><button className="btn btn-primary" onClick={exportAll} disabled={!overview||!!exporting}><Download size={15}/>{exporting==='all'?'產生中…':'下載完整移轉 JSON'}</button></div></div>
      {overview&&<><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10,marginTop:16}}>{Object.entries(overview.metrics||{}).map(([k,v])=><div key={k} style={{padding:12,border:'1px solid var(--border)',borderRadius:10}}><div style={{fontSize:11,color:'var(--text-muted)'}}>{k}</div><div style={{fontWeight:800,fontSize:18,marginTop:4}}>{String(v??0)}</div></div>)}</div>
      <div style={{overflowX:'auto',marginTop:16}}><table><thead><tr><th>資料表</th><th>欄位數</th><th></th></tr></thead><tbody>{tableRows.map(t=><tr key={t}><td><strong>{t}</strong></td><td>{(overview.columns||[]).filter(c=>c.table_name===t).length}</td><td>{overview.export_tables?.includes(t)?<button className="btn btn-sm btn-ghost" disabled={!!exporting} onClick={()=>exportTable(t)}><Download size={13}/>{exporting===t?'匯出中…':'JSON'}</button>:<span style={{fontSize:12,color:'var(--text-muted)'}}>僅結構</span>}</td></tr>)}</tbody></table></div></>}
    </div>
    <div className="card" style={{padding:20}}><h3>資料庫物件</h3><p>Columns：{overview?.columns?.length||0}　Constraints：{overview?.constraints?.length||0}　Indexes：{overview?.indexes?.length||0}　Triggers：{overview?.triggers?.length||0}　Functions：{overview?.functions?.length||0}　Views：{overview?.views?.length||0}</p></div>
  </div>
}
