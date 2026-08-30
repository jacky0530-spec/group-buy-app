import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, CheckSquare, RefreshCw } from 'lucide-react'
import { neonRuntime } from '../lib/neonRuntime'
import { neonOrderStatusRuntime } from '../lib/neonOrderStatusRuntime'
import { useToast } from './UI'

export default function IncomingArchivePanel(){
  const toast=useToast()
  const[loading,setLoading]=useState(true)
  const[archiving,setArchiving]=useState(false)
  const[batches,setBatches]=useState([])
  const[products,setProducts]=useState([])
  const[selectedBatchId,setSelectedBatchId]=useState('')
  const[selectedIds,setSelectedIds]=useState([])

  const load=useCallback(async()=>{
    setLoading(true)
    try{
      const [batchData,productData]=await Promise.all([
        neonOrderStatusRuntime('incoming_list',{status:'completed'}),
        neonRuntime('list_products',{includeArchived:true}),
      ])
      const completed=(batchData?.result||[]).filter(b=>b.status==='completed')
      setBatches(completed)
      setProducts(productData?.rows||[])
      setSelectedBatchId(current=>completed.some(b=>b.id===current)?current:(completed[0]?.id||''))
      setSelectedIds([])
    }catch(e){toast('已完成商品封存資料載入失敗：'+e.message,'error')}
    finally{setLoading(false)}
  },[toast])

  useEffect(()=>{load()},[load])

  const activeBatch=batches.find(b=>b.id===selectedBatchId)||null
  const productState=useMemo(()=>new Map(products.map(p=>[p.id,p])),[products])
  const batchProducts=useMemo(()=>{
    const map=new Map()
    for(const item of activeBatch?.items||[]){
      const id=String(item.product_id||'').trim()
      if(!id)continue
      if(!map.has(id))map.set(id,{id,name:item.product_name||id,specs:0,received:0})
      const row=map.get(id)
      row.specs+=1
      row.received+=Number(item.received_qty||0)
    }
    return [...map.values()].map(p=>({...p,archived:productState.get(p.id)?.active===false}))
  },[activeBatch,productState])
  const selectable=batchProducts.filter(p=>!p.archived)

  const toggle=id=>setSelectedIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])
  const selectAll=()=>setSelectedIds(selectable.map(p=>p.id))

  const archiveIds=async(ids,label)=>{
    const unique=[...new Set(ids)].filter(Boolean)
    if(!unique.length){toast('沒有可封存商品','error');return}
    if(!window.confirm(`確定要封存${label} ${unique.length} 項商品？\n\n只會停止商品主檔繼續使用，不會刪除歷史訂單、到貨紀錄、付款或報表。`))return
    setArchiving(true)
    const failed=[]
    let done=0
    try{
      for(const id of unique){
        try{await neonRuntime('write_product',{op:'archive',id});done++}
        catch(e){failed.push({id,error:e.message})}
      }
      if(done)toast(`✅ 已封存 ${done} 項商品`)
      if(failed.length)toast(`有 ${failed.length} 項封存失敗，請重新整理後再試`,'error')
      await load()
    }finally{setArchiving(false)}
  }

  if(loading)return <div className="card no-print" style={{marginTop:15,padding:20,color:'var(--text-muted)'}}>載入已完成商品封存資料...</div>
  if(!batches.length)return null

  return <div className="card no-print" style={{marginTop:15}}>
    <div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap'}}>
      <div><strong>📦 已完成批次商品封存</strong><div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>封存只停用商品主檔；歷史訂單、到貨、付款與報表全部保留。</div></div>
      <button className="btn btn-sm btn-ghost" onClick={load} disabled={archiving}><RefreshCw size={14}/>重新整理</button>
    </div>
    <div className="card-body">
      <div className="form-group" style={{maxWidth:620}}><label>選擇已完成到貨批次</label><select value={selectedBatchId} onChange={e=>{setSelectedBatchId(e.target.value);setSelectedIds([])}}>{batches.map(b=><option key={b.id} value={b.id}>{b.supplier}｜{String(b.completed_at||b.expected_date||'').slice(0,10)}｜{(b.items||[]).length} 規格</option>)}</select></div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:10}}><button className="btn btn-sm btn-ghost" onClick={selectAll} disabled={!selectable.length||archiving}><CheckSquare size={14}/>全選可封存</button><button className="btn btn-sm btn-primary" onClick={()=>archiveIds(selectedIds,'勾選的')} disabled={!selectedIds.length||archiving}><Archive size={14}/>{archiving?'封存中...':`批次封存（${selectedIds.length}）`}</button><span style={{fontSize:12,color:'var(--text-muted)'}}>同一商品不同規格會合併，只封存一次商品主檔。</span></div>
      <div className="table-container"><table><thead><tr><th style={{width:46}}></th><th>商品</th><th>本批規格</th><th>本批實收</th><th>狀態</th><th style={{textAlign:'right'}}>操作</th></tr></thead><tbody>{batchProducts.map(p=><tr key={p.id} style={{opacity:p.archived?.58:1}}><td><input type="checkbox" checked={selectedIds.includes(p.id)} disabled={p.archived||archiving} onChange={()=>toggle(p.id)}/></td><td><strong>{p.name}</strong></td><td>{p.specs}</td><td>{p.received}</td><td>{p.archived?<span className="badge badge-gray">已封存</span>:<span className="badge badge-emerald">使用中</span>}</td><td style={{textAlign:'right'}}>{!p.archived&&<button className="btn btn-sm btn-ghost" style={{color:'var(--rose)'}} disabled={archiving} onClick={()=>archiveIds([p.id],`「${p.name}」`)}><Archive size={13}/>封存商品</button>}</td></tr>)}{!batchProducts.length&&<tr><td colSpan={6} style={{textAlign:'center',padding:20,color:'var(--text-muted)'}}>此批次沒有可辨識的商品主檔</td></tr>}</tbody></table></div>
    </div>
  </div>
}
