import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { Database, RefreshCw, Play, CheckCircle2, AlertTriangle, Clock3 } from 'lucide-react'
import { db } from '../lib/firebase'
import { useAuth } from '../components/AuthGuard'
import { useToast } from '../components/UI'

const TABLES = [
  { key:'accounts', label:'帳號／權限', collection:'accounts' },
  { key:'customers', label:'客戶', collection:'customers' },
  { key:'products', label:'商品', collection:'products' },
  { key:'orders', label:'訂單', collection:'orders' },
  { key:'helper_entries', label:'小幫手紀錄', collection:'helper_entries' },
  { key:'stock_inventory', label:'現貨庫存', collection:'stock_inventory' },
  { key:'supplier_payments', label:'供應商付款', collection:'supplier_payments' },
]

const PENDING_TABLES = [
  { label:'額外叫貨', collection:'stock_purchase_extras', reason:'等待補 legacy_id 去重欄位' },
  { label:'其他費用', collection:'expenses', reason:'等待 Neon 欄位與現行費用模型對齊' },
]

function cleanValue(value){
  if(value == null) return value
  if(typeof value?.toDate === 'function') return value.toDate().toISOString()
  if(Array.isArray(value)) return value.map(cleanValue)
  if(typeof value === 'object'){
    const out = {}
    Object.entries(value).forEach(([k,v]) => { out[k] = cleanValue(v) })
    return out
  }
  return value
}

async function readCollection(name){
  const snap = await getDocs(collection(db,name))
  return snap.docs.map(d => ({ id:d.id,...cleanValue(d.data()) }))
}

async function postMigration(user,action,rows=[]){
  const token = await user.getIdToken(true)
  const response = await fetch('/api/neon-migrate',{
    method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
    body:JSON.stringify({ action,rows }),
  })
  const data = await response.json().catch(() => ({}))
  if(!response.ok || !data.ok) throw new Error(data.error || `API 錯誤 ${response.status}`)
  return data
}

function chunks(rows,size){
  const out=[]
  for(let i=0;i<rows.length;i+=size) out.push(rows.slice(i,i+size))
  return out
}

export default function DataMigration(){
  const { user,role } = useAuth()
  const toast = useToast()
  const [source,setSource] = useState({})
  const [pendingSource,setPendingSource] = useState({})
  const [target,setTarget] = useState(null)
  const [loading,setLoading] = useState(false)
  const [running,setRunning] = useState(false)
  const [progress,setProgress] = useState({})
  const [error,setError] = useState('')

  const sourceCounts = useMemo(() => Object.fromEntries(TABLES.map(t => [t.key,(source[t.key] || []).length])),[source])

  const inspect = useCallback(async()=>{
    if(!user) return
    setLoading(true);setError('')
    try{
      const pairs = await Promise.all(TABLES.map(async t => [t.key,await readCollection(t.collection)]))
      const pendingPairs = await Promise.all(PENDING_TABLES.map(async t => [t.collection,await readCollection(t.collection)]))
      setSource(Object.fromEntries(pairs))
      setPendingSource(Object.fromEntries(pendingPairs))
      const result=await postMigration(user,'counts',[])
      setTarget(result.counts)
    }catch(err){
      setTarget(null);setError(err.message);toast('資料庫檢查失敗：'+err.message,'error')
    }finally{setLoading(false)}
  },[user,toast])

  useEffect(()=>{ if(user && role==='owner') inspect() },[user,role,inspect])

  async function migrate(){
    if(role!=='owner') return toast('只有負責人可以執行資料庫搬移','error')
    if(!source.orders) await inspect()
    if(!window.confirm('開始將目前 Firestore 的核心資料複製到 Neon？\n\n包含帳號、客戶、商品、訂單、小幫手、現貨與供應商付款。此操作不會刪除 Firebase 原資料，可以重複執行。')) return
    setRunning(true);setError('');setProgress({})
    try{
      for(const table of TABLES){
        const rows = source[table.key] || []
        const batchSize = table.key==='orders' ? 80 : table.key==='supplier_payments' ? 80 : 180
        let done=0
        setProgress(p=>({...p,[table.key]:{done:0,total:rows.length,status:'running'}}))
        for(const batch of chunks(rows,batchSize)){
          await postMigration(user,table.key,batch)
          done += batch.length
          setProgress(p=>({...p,[table.key]:{done,total:rows.length,status:'running'}}))
        }
        setProgress(p=>({...p,[table.key]:{done:rows.length,total:rows.length,status:'done'}}))
      }
      const result = await postMigration(user,'counts',[])
      setTarget(result.counts)
      toast('目前可安全搬移的資料已完成 ✓')
    }catch(err){
      setError(err.message);toast('搬移中止：'+err.message,'error')
    }finally{setRunning(false)}
  }

  if(role && role!=='owner') return <div className="card" style={{padding:28}}><AlertTriangle size={20}/> 此頁僅限負責人使用。</div>

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:16}}>
      <div><h2 style={{margin:0,display:'flex',gap:8,alignItems:'center'}}><Database size={22}/>資料庫搬移</h2><div style={{fontSize:13,color:'var(--text-muted)',marginTop:5}}>Firebase Authentication 保留；Firestore 業務資料複製到 Neon PostgreSQL。</div></div>
      <div style={{display:'flex',gap:8}}><button className="btn btn-ghost" disabled={loading||running} onClick={inspect}><RefreshCw size={14}/>{loading?'讀取中...':'重新分析'}</button><button className="btn btn-primary" disabled={loading||running||!source.orders} onClick={migrate}><Play size={14}/>{running?'搬移中...':'開始搬移'}</button></div>
    </div>

    {error&&<div style={{padding:12,borderRadius:10,background:'#fff1f2',color:'#be123c',marginBottom:14,fontWeight:800}}>{error}</div>}

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10,marginBottom:16}}>
      {TABLES.map(t=>{const p=progress[t.key];return <div className="card" key={t.key} style={{padding:14}}><div style={{fontSize:12,color:'var(--text-muted)'}}>{t.label}</div><div style={{fontSize:26,fontWeight:900,margin:'4px 0'}}>{sourceCounts[t.key] ?? '—'} <span style={{fontSize:12,fontWeight:600}}>Firestore</span></div><div style={{fontSize:13,fontWeight:800,color:p?.status==='done'?'#047857':'var(--text-secondary)'}}>{p?.status==='done'?<><CheckCircle2 size={13}/> 已搬 {p.done}/{p.total}</>:p?.status==='running'?`搬移中 ${p.done}/${p.total}`:`Neon：${target?.[t.key] ?? '—'}`}</div></div>})}
    </div>

    <div className="card" style={{padding:18,marginBottom:16}}>
      <strong style={{display:'flex',gap:7,alignItems:'center'}}><Clock3 size={16}/>下一階段待搬資料</strong>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:8,marginTop:10}}>{PENDING_TABLES.map(t=><div key={t.collection} style={{padding:10,border:'1px solid var(--border)',borderRadius:9}}><div style={{fontWeight:800}}>{t.label}：{(pendingSource[t.collection]||[]).length} 筆</div><div style={{fontSize:12,color:'var(--text-muted)',marginTop:3}}>{t.reason}</div></div>)}</div>
    </div>

    <div className="card" style={{padding:18}}>
      <strong>搬移原則</strong>
      <div style={{fontSize:13,lineHeight:1.8,color:'var(--text-secondary)',marginTop:8}}>原 Firestore 文件 ID 會保存成 legacy_id／firebase_uid 或透過商品＋規格唯一鍵對應，用來避免重複匯入並保留資料關聯。再次執行會更新既有資料，不會重複建立同一筆核心資料。Firebase 原資料在完成核對與正式切換前都不會刪除。</div>
    </div>
  </div>
}
