import { useCallback, useEffect, useMemo, useState } from 'react'
import { PackageCheck, Plus, Printer, RefreshCw, Search, Truck, WalletCards } from 'lucide-react'
import { neonPaymentsRuntime } from '../lib/neonRuntime'
import { neonOrderStatusRuntime } from '../lib/neonOrderStatusRuntime'
import { useToast } from '../components/UI'

const money=v=>`NT$${Math.round(Number(v||0)).toLocaleString()}`
const today=()=>new Date().toISOString().slice(0,10)
const specLabel=i=>[
  i.spec_package&&`組合：${i.spec_package}`,
  i.spec_flavor&&`口味：${i.spec_flavor}`,
  i.spec_color&&`顏色：${i.spec_color}`,
  i.spec_size&&`尺寸：${i.spec_size}`,
].filter(Boolean).join('／')||'一般規格'
const statusLabel=s=>s==='completed'?'已完成':s==='receiving'?'理貨中':s==='cancelled'?'已取消':'即將到貨'
const payId=()=>`incoming-pay-${Date.now()}-${Math.random().toString(36).slice(2,8)}`

export default function IncomingBatches(){
  const toast=useToast()
  const[loading,setLoading]=useState(true)
  const[suppliers,setSuppliers]=useState([])
  const[batches,setBatches]=useState([])
  const[selectedSupplier,setSelectedSupplier]=useState('')
  const[candidates,setCandidates]=useState([])
  const[selectedKeys,setSelectedKeys]=useState([])
  const[search,setSearch]=useState('')
  const[expectedDate,setExpectedDate]=useState(today())
  const[note,setNote]=useState('')
  const[activeId,setActiveId]=useState('')
  const[draftItems,setDraftItems]=useState([])
  const[saving,setSaving]=useState(false)
  const[paymentLines,setPaymentLines]=useState([])
  const[paymentAmount,setPaymentAmount]=useState('')
  const[paymentNote,setPaymentNote]=useState('')
  const[paymentDate,setPaymentDate]=useState(today())
  const[paying,setPaying]=useState(false)

  const loadHome=useCallback(async()=>{
    setLoading(true)
    try{
      const [c,l]=await Promise.all([
        neonOrderStatusRuntime('incoming_candidates'),
        neonOrderStatusRuntime('incoming_list'),
      ])
      setSuppliers(c?.result?.suppliers||[])
      setBatches(l?.result||[])
    }catch(e){toast('即將到貨資料載入失敗：'+e.message,'error')}
    finally{setLoading(false)}
  },[toast])

  useEffect(()=>{loadHome()},[loadHome])

  const chooseSupplier=async name=>{
    setSelectedSupplier(name);setSelectedKeys([]);setCandidates([]);setSearch('')
    try{
      const data=await neonOrderStatusRuntime('incoming_candidates',{supplier:name})
      setCandidates(data?.result?.rows||[])
    }catch(e){toast('供應商未到貨商品載入失敗：'+e.message,'error')}
  }

  const keyOf=i=>[i.product_id,i.spec_package,i.spec_flavor,i.spec_color,i.spec_size].join('|')
  const visibleCandidates=useMemo(()=>{
    const q=search.trim().toLowerCase()
    return candidates.filter(i=>!q||String(i.product_name||'').toLowerCase().includes(q)||specLabel(i).toLowerCase().includes(q))
  },[candidates,search])
  const selectedCandidates=useMemo(()=>candidates.filter(i=>selectedKeys.includes(keyOf(i))),[candidates,selectedKeys])
  const selectedQty=selectedCandidates.reduce((s,i)=>s+Number(i.remaining_qty||0),0)
  const selectedCost=selectedCandidates.reduce((s,i)=>s+Number(i.remaining_qty||0)*Number(i.unit_cost||0),0)

  const toggleCandidate=i=>{
    const k=keyOf(i)
    setSelectedKeys(p=>p.includes(k)?p.filter(x=>x!==k):[...p,k])
  }
  const selectVisible=()=>setSelectedKeys(p=>[...new Set([...p,...visibleCandidates.map(keyOf)])])

  const createBatch=async()=>{
    if(!selectedSupplier||!selectedCandidates.length){toast('請先選擇供應商與本次預計送貨商品','error');return}
    setSaving(true)
    try{
      const data=await neonOrderStatusRuntime('incoming_create',{
        supplier:selectedSupplier,expected_date:expectedDate,note,
        items:selectedCandidates.map(i=>({...i,expected_qty:Number(i.remaining_qty||0)})),
      })
      const newId=data?.result?.id||''
      toast(`✅ 已建立 ${selectedSupplier} 即將到貨批次，共 ${data?.result?.item_count||0} 種商品`)
      setSelectedKeys([]);setNote('');setSelectedSupplier('');setCandidates([])
      if(newId)setActiveId(newId)
      await loadHome()
    }catch(e){toast('建立即將到貨批次失敗：'+e.message,'error')}
    finally{setSaving(false)}
  }

  const openBatch=id=>{
    const batch=batches.find(b=>b.id===id)
    if(!batch)return
    setActiveId(id)
    setDraftItems((batch.items||[]).map(i=>({...i})))
    setPaymentLines([]);setPaymentAmount('');setPaymentNote('')
  }

  useEffect(()=>{
    if(!activeId)return
    const batch=batches.find(b=>b.id===activeId)
    if(batch)setDraftItems((batch.items||[]).map(i=>({...i})))
  },[batches,activeId])

  const activeBatch=batches.find(b=>b.id===activeId)||null
  const fillExpected=()=>setDraftItems(p=>p.map(i=>({...i,received_qty:Number(i.expected_qty||0)})))
  const setReceived=(id,value)=>setDraftItems(p=>p.map(i=>i.id===id?{...i,received_qty:Math.max(0,Math.min(Number(i.expected_qty||0),Math.trunc(Number(value)||0)))}:i))
  const draftReceived=draftItems.reduce((s,i)=>s+Number(i.received_qty||0),0)
  const draftAmount=draftItems.reduce((s,i)=>s+Number(i.received_qty||0)*Number(i.unit_cost||0),0)

  const saveReceiving=async()=>{
    if(!activeBatch||activeBatch.status==='completed')return
    setSaving(true)
    try{
      await neonOrderStatusRuntime('incoming_save',{id:activeBatch.id,expected_date:activeBatch.expected_date||today(),note:activeBatch.note||'',items:draftItems})
      toast('理貨進度已儲存')
      await loadHome()
    }catch(e){toast('儲存理貨進度失敗：'+e.message,'error')}
    finally{setSaving(false)}
  }

  const loadBatchPaymentLines=async(batch,affected)=>{
    try{
      const data=await neonPaymentsRuntime('supplier_payables',{supplier:batch.supplier})
      const all=Array.isArray(data?.rows)?data.rows:[]
      const keys=new Set((affected||[]).map(a=>`${a.order_id}|${Number(a.item_index)}`))
      const rows=all.filter(l=>keys.has(`${l.order_id}|${Number(l.item_index)}`)&&l.isEligible)
      setPaymentLines(rows)
      const total=rows.reduce((s,l)=>s+Number(l.outstanding||0),0)
      setPaymentAmount(total?String(Math.round(total)):'')
    }catch(e){toast('本批待付款明細載入失敗：'+e.message,'error')}
  }

  const completeBatch=async()=>{
    if(!activeBatch||activeBatch.status==='completed')return
    if(!(draftReceived>0)){toast('本批實收總量必須大於 0','error');return}
    if(!window.confirm(`確認完成本批到貨？\n供應商：${activeBatch.supplier}\n實收：${draftReceived} 件\n預估成本：${money(draftAmount)}\n\n完成後會正式更新相關訂單到貨數量。`))return
    setSaving(true)
    try{
      await neonOrderStatusRuntime('incoming_save',{id:activeBatch.id,expected_date:activeBatch.expected_date||today(),note:activeBatch.note||'',items:draftItems})
      const data=await neonOrderStatusRuntime('incoming_complete',{id:activeBatch.id})
      const result=data?.result||{}
      toast(`✅ 本批到貨完成，共分配 ${result.allocated||0} 件`)
      const updated=await neonOrderStatusRuntime('incoming_list')
      const nextBatches=updated?.result||[]
      setBatches(nextBatches)
      const finished=nextBatches.find(b=>b.id===activeBatch.id)||activeBatch
      await loadBatchPaymentLines(finished,result.affected||[])
      const c=await neonOrderStatusRuntime('incoming_candidates')
      setSuppliers(c?.result?.suppliers||[])
    }catch(e){toast('完成批次到貨失敗：'+e.message,'error')}
    finally{setSaving(false)}
  }

  const payBatch=async()=>{
    const amount=Number(paymentAmount||0)
    if(!activeBatch||!paymentLines.length){toast('本批目前沒有可付款明細','error');return}
    const max=paymentLines.reduce((s,l)=>s+Number(l.outstanding||0),0)
    if(!(amount>0)||amount>max+0.01){toast(`付款金額需介於 1 ～ ${money(max)}`,'error');return}
    setPaying(true)
    try{
      const data=await neonPaymentsRuntime('create',{
        id:payId(),supplier:activeBatch.supplier,payment_date:paymentDate,amount,
        note:`即將到貨批次 ${activeBatch.id}${paymentNote?`｜${paymentNote}`:''}`,
        lines:paymentLines,
      })
      const result=data?.result||{}
      toast(`✅ 本批已建立付款 ${money(result.amount)}，分配 ${result.allocation_count||0} 筆`)
      setPaymentLines([]);setPaymentAmount('');setPaymentNote('')
    }catch(e){toast('本批付款失敗：'+e.message,'error')}
    finally{setPaying(false)}
  }

  return <div className="animate-fade">
    <div className="no-print" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:16}}>
      <div><h2 style={{fontSize:22,fontWeight:900}}>🚚 即將到貨</h2><p style={{fontSize:13,color:'var(--text-secondary)',marginTop:3}}>先把廠商這次要送的商品拉成一批；貨到後理貨、一次完成到貨，再直接處理本批付款。</p></div>
      <button className="btn btn-ghost" onClick={loadHome} disabled={loading||saving}><RefreshCw size={15}/>重新整理</button>
    </div>

    <div className="no-print" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:14,alignItems:'start'}}>
      <div className="card"><div className="card-header" style={{fontWeight:900}}>1. 選擇供應商</div><div className="card-body">{loading?<div className="empty-state">讀取中...</div>:suppliers.length===0?<div className="empty-state">目前沒有尚未完整到貨商品</div>:suppliers.map(s=><button key={s.supplier} onClick={()=>chooseSupplier(s.supplier)} style={{width:'100%',textAlign:'left',padding:'10px 12px',marginBottom:7,borderRadius:10,border:`2px solid ${selectedSupplier===s.supplier?'var(--indigo)':'var(--border)'}`,background:selectedSupplier===s.supplier?'var(--indigo-light)':'var(--surface)',cursor:'pointer'}}><div style={{fontWeight:900}}>{s.supplier}</div><div style={{fontSize:12,color:'var(--text-muted)',marginTop:3}}>{s.product_count} 種商品｜尚欠 {s.remaining_qty} 件｜{money(s.remaining_cost)}</div></button>)}</div></div>

      <div className="card"><div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}><strong>2. 勾選本次預計送貨商品</strong>{selectedSupplier&&<button className="btn btn-sm btn-ghost" onClick={selectVisible}>全選目前清單</button>}</div><div className="card-body">{!selectedSupplier?<div className="empty-state">先選左側供應商</div>:<><div className="search-input-wrap" style={{marginBottom:10}}><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋商品或規格..."/></div><div style={{maxHeight:430,overflow:'auto'}}>{visibleCandidates.map(i=>{const k=keyOf(i),checked=selectedKeys.includes(k);return <label key={k} style={{display:'grid',gridTemplateColumns:'28px 1fr auto',gap:9,alignItems:'center',padding:'10px 4px',borderBottom:'1px solid var(--border)',cursor:'pointer'}}><input type="checkbox" checked={checked} onChange={()=>toggleCandidate(i)}/><div><div style={{fontWeight:850}}>{i.product_name}</div><div style={{fontSize:11,color:'var(--indigo)',fontWeight:700}}>{specLabel(i)}</div><div style={{fontSize:11,color:'var(--text-muted)'}}>{i.order_count} 張訂單</div></div><div style={{textAlign:'right'}}><strong>{i.remaining_qty} 件</strong><div style={{fontSize:11,color:'var(--text-muted)'}}>{money(Number(i.remaining_qty)*Number(i.unit_cost))}</div></div></label>})}</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:9,marginTop:12}}><div className="form-group"><label>預計到貨日</label><input type="date" value={expectedDate} onChange={e=>setExpectedDate(e.target.value)}/></div><div className="form-group"><label>備註</label><input value={note} onChange={e=>setNote(e.target.value)} placeholder="例：週六早上送到"/></div></div><div style={{background:'var(--indigo-light)',padding:10,borderRadius:10,fontSize:12,marginBottom:10}}>已選 <strong>{selectedCandidates.length}</strong> 種｜共 <strong>{selectedQty}</strong> 件｜預估成本 <strong>{money(selectedCost)}</strong></div><button className="btn btn-primary" style={{width:'100%',justifyContent:'center'}} disabled={saving||!selectedCandidates.length} onClick={createBatch}><Plus size={16}/>{saving?'建立中...':'建立即將到貨批次'}</button></>}</div></div>
    </div>

    <div className="card no-print" style={{marginTop:15}}><div className="card-header" style={{fontWeight:900}}>📦 到貨批次</div><div className="table-container"><table><thead><tr><th>狀態</th><th>供應商</th><th>預計到貨</th><th>商品</th><th>預計 / 實收</th><th></th></tr></thead><tbody>{batches.map(b=>{const expected=(b.items||[]).reduce((s,i)=>s+Number(i.expected_qty||0),0),received=(b.items||[]).reduce((s,i)=>s+Number(i.received_qty||0),0);return <tr key={b.id}><td><span className={`badge ${b.status==='completed'?'badge-emerald':b.status==='receiving'?'badge-amber':'badge-indigo'}`}>{statusLabel(b.status)}</span></td><td style={{fontWeight:850}}>{b.supplier}</td><td>{b.expected_date||'—'}</td><td>{(b.items||[]).length} 種</td><td>{expected} / <strong>{received}</strong></td><td><button className="btn btn-sm btn-ghost" onClick={()=>openBatch(b.id)}>開啟</button></td></tr>})}{!batches.length&&<tr><td colSpan={6} style={{textAlign:'center',padding:24,color:'var(--text-muted)'}}>尚未建立到貨批次</td></tr>}</tbody></table></div></div>

    {activeBatch&&<div className="card" style={{marginTop:15}}><div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap'}}><div><strong>{activeBatch.supplier}｜{statusLabel(activeBatch.status)}</strong><div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>批次 {activeBatch.id}｜預計 {activeBatch.expected_date||'未設定'}</div></div><button className="btn btn-sm btn-ghost no-print" onClick={()=>window.print()}><Printer size={14}/>列印到貨表單</button></div><div className="card-body">
      <div className="print-only" style={{marginBottom:14}}><h2>到貨表單</h2><div>供應商：{activeBatch.supplier}　批次：{activeBatch.id}　預計到貨：{activeBatch.expected_date||'—'}　完成：{activeBatch.completed_at||'—'}</div></div>
      <div className="table-container"><table><thead><tr><th>商品 / 規格</th><th>預計</th><th>實收</th><th>單位成本</th><th>本批成本</th></tr></thead><tbody>{draftItems.map(i=><tr key={i.id}><td><div style={{fontWeight:850}}>{i.product_name}</div><div style={{fontSize:11,color:'var(--indigo)'}}>{specLabel(i)}</div></td><td>{i.expected_qty}</td><td>{activeBatch.status==='completed'?<strong>{i.received_qty}</strong>:<><input className="no-print" type="number" min="0" max={i.expected_qty} value={i.received_qty} onFocus={e=>e.currentTarget.select()} onClick={e=>e.currentTarget.select()} onChange={e=>setReceived(i.id,e.target.value)} style={{width:90}}/><span className="print-only">{i.received_qty}</span></>}</td><td>{money(i.unit_cost)}</td><td>{money(Number(i.received_qty)*Number(i.unit_cost))}</td></tr>)}</tbody></table></div>
      <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap',marginTop:12}}><div><strong>實收 {draftReceived} 件</strong>　預估成本 <strong>{money(draftAmount)}</strong></div>{activeBatch.status!=='completed'&&<div className="no-print" style={{display:'flex',gap:7,flexWrap:'wrap'}}><button className="btn btn-ghost" onClick={fillExpected}>全部符合預計數量</button><button className="btn btn-ghost" disabled={saving} onClick={saveReceiving}>儲存理貨</button><button className="btn btn-primary" disabled={saving||draftReceived<=0} onClick={completeBatch}><PackageCheck size={15}/>{saving?'處理中...':'完成本批到貨'}</button></div>}</div>

      {activeBatch.status==='completed'&&<div className="no-print" style={{marginTop:16,paddingTop:14,borderTop:'1px solid var(--border)'}}><div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}><WalletCards size={18}/><strong>本批付款</strong></div>{paymentLines.length===0?<div style={{padding:12,borderRadius:10,background:'var(--emerald-light)',fontSize:12}}>若本批剛完成且有可手動付款明細，系統會自動帶入；若沒有，代表已付款或付款條件由系統自動處理。</div>:<><div style={{background:'var(--amber-light)',padding:10,borderRadius:10,fontSize:12,marginBottom:10}}>本批可付款 {paymentLines.length} 筆，共 <strong>{money(paymentLines.reduce((s,l)=>s+Number(l.outstanding||0),0))}</strong>。只包含本批實際到貨影響的訂單。</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:9}}><div className="form-group"><label>付款日期</label><input type="date" value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}/></div><div className="form-group"><label>本次付款金額</label><input type="number" min="1" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)}/></div></div><div className="form-group"><label>付款備註</label><input value={paymentNote} onChange={e=>setPaymentNote(e.target.value)} placeholder="例：本批貨到全額付款"/></div><button className="btn btn-primary" disabled={paying} onClick={payBatch}><Truck size={15}/>{paying?'付款處理中...':'完成本批付款'}</button></>}</div>}
    </div></div>}
  </div>
}
