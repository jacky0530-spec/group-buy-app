import { useCallback, useEffect, useMemo, useState } from 'react'
import { SupplierPaymentsAPI } from '../lib/db'
import { neonPaymentsRuntime } from '../lib/neonRuntime'
import { useToast } from '../components/UI'
import { CreditCard, RefreshCw, Search, WalletCards } from 'lucide-react'

const money = v => `NT$${Math.round(Number(v || 0)).toLocaleString()}`
const today = () => new Date().toISOString().slice(0,10)
const termLabel = term => term === 'order' ? '訂貨即付款（到貨自動補登）' : term === 'arrival' ? '到貨後付款（自動）' : '手動付款'

export default function SupplierPayments(){
  const toast=useToast()
  const[suppliers,setSuppliers]=useState([]),[payments,setPayments]=useState([]),[summary,setSummary]=useState({ready:0,waiting:0,allPaid:0,paidNotArrived:0})
  const[supplierLines,setSupplierLines]=useState([]),[loading,setLoading]=useState(true),[detailsLoading,setDetailsLoading]=useState(false)
  const[selectedSupplier,setSelectedSupplier]=useState(''),[search,setSearch]=useState(''),[selected,setSelected]=useState([])
  const[paymentDate,setPaymentDate]=useState(today()),[paymentAmount,setPaymentAmount]=useState(''),[note,setNote]=useState(''),[saving,setSaving]=useState(false)

  const load=useCallback(async()=>{
    setLoading(true)
    try{
      const result=await neonPaymentsRuntime('dashboard')
      setSuppliers(Array.isArray(result?.suppliers)?result.suppliers:[])
      setPayments(Array.isArray(result?.payments)?result.payments:[])
      setSummary(result?.summary||{ready:0,waiting:0,allPaid:0,paidNotArrived:0})
    }catch(e){toast('供應商付款資料載入失敗：'+e.message,'error')}
    finally{setLoading(false)}
  },[toast])
  useEffect(()=>{load()},[load])

  const visibleSuppliers=useMemo(()=>{
    const q=search.trim().toLowerCase()
    return suppliers.filter(g=>!q||String(g.supplier||'').toLowerCase().includes(q))
  },[suppliers,search])
  const readyLines=useMemo(()=>supplierLines.filter(l=>l.isEligible),[supplierLines])
  const selectedLines=useMemo(()=>readyLines.filter(l=>selected.includes(l.key)),[readyLines,selected])
  const selectedTotal=selectedLines.reduce((s,l)=>s+Number(l.outstanding||0),0)

  const loadSupplier=useCallback(async(name,{autoSelect=false}={})=>{
    if(!name){setSupplierLines([]);setSelected([]);return[]}
    setDetailsLoading(true)
    try{
      const result=await neonPaymentsRuntime('supplier_payables',{supplier:name})
      const rows=Array.isArray(result?.rows)?result.rows:[]
      setSupplierLines(rows)
      if(autoSelect){
        const eligibleRows=rows.filter(l=>l.isEligible)
        setSelected(eligibleRows.map(l=>l.key))
        const total=eligibleRows.reduce((s,l)=>s+Number(l.outstanding||0),0)
        setPaymentAmount(total?String(Math.round(total)):'')
      }
      return rows
    }catch(e){toast('供應商待付款明細載入失敗：'+e.message,'error');return[]}
    finally{setDetailsLoading(false)}
  },[toast])

  async function chooseSupplier(name){
    setSelectedSupplier(name);setSelected([]);setPaymentAmount('');setNote('');setSupplierLines([])
    await loadSupplier(name,{autoSelect:true})
  }
  function toggle(key){setSelected(p=>p.includes(key)?p.filter(x=>x!==key):[...p,key])}
  function selectAll(){const keys=readyLines.map(l=>l.key);setSelected(keys);setPaymentAmount(String(Math.round(readyLines.reduce((s,l)=>s+Number(l.outstanding||0),0))))}
  function clearAll(){setSelected([]);setPaymentAmount('')}

  async function refresh(){
    await load()
    if(selectedSupplier) await loadSupplier(selectedSupplier,{autoSelect:false})
  }

  async function confirmPayment(){
    const amount=Number(paymentAmount||0)
    if(!selectedSupplier||!selectedLines.length){toast('請先選擇供應商與付款明細','error');return}
    if(!(amount>0)){toast('請輸入實際匯款金額','error');return}
    if(amount-selectedTotal>0.01){toast(`實際匯款不可超過已選待付金額 ${money(selectedTotal)}`,'error');return}
    setSaving(true)
    try{
      const result=await SupplierPaymentsAPI.createPayment({supplier:selectedSupplier,payment_date:paymentDate,amount,note:note.trim(),lines:selectedLines})
      toast(`✅ ${selectedSupplier} 已建立付款 ${money(result.amount)}，共分配 ${result.allocation_count} 筆明細`)
      setSelected([]);setPaymentAmount('');setNote('')
      await load()
      await loadSupplier(selectedSupplier,{autoSelect:false})
    }catch(e){toast('付款失敗：'+e.message,'error')}finally{setSaving(false)}
  }

  return <div className="animate-fade">
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:18}}><div><h2 style={{fontSize:22,fontWeight:800}}>供應商付款中心</h2><p style={{fontSize:13,color:'var(--text-secondary)',marginTop:3}}>待付款與統計已由 Neon SQL 直接聚合；只有點選供應商時才讀取該供應商明細，不再下載全部訂單。</p></div><button className="btn btn-ghost" onClick={refresh} disabled={loading||detailsLoading}><RefreshCw size={14}/>重新整理</button></div>

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:18}}>
      <div className="stat-card" style={{background:'linear-gradient(135deg,#f59e0b,#d97706)'}}><div style={{fontSize:11,fontWeight:800}}>目前可手動付款</div><div style={{fontSize:22,fontWeight:900,marginTop:5}}>{money(summary.ready)}</div><WalletCards size={28} style={{position:'absolute',right:14,top:18,opacity:.25}}/></div>
      <div className="stat-card" style={{background:'linear-gradient(135deg,#64748b,#475569)'}}><div style={{fontSize:11,fontWeight:800}}>尚未達付款條件</div><div style={{fontSize:22,fontWeight:900,marginTop:5}}>{money(summary.waiting)}</div></div>
      <div className="stat-card" style={{background:'linear-gradient(135deg,#10b981,#059669)'}}><div style={{fontSize:11,fontWeight:800}}>累計付款紀錄</div><div style={{fontSize:22,fontWeight:900,marginTop:5}}>{money(summary.allPaid)}</div></div>
      <div className="stat-card" style={{background:'linear-gradient(135deg,#3b82f6,#2563eb)'}}><div style={{fontSize:11,fontWeight:800}}>已付未到貨</div><div style={{fontSize:22,fontWeight:900,marginTop:5}}>{money(summary.paidNotArrived)}</div></div>
    </div>

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:14,alignItems:'start'}}>
      <div className="card"><div className="card-header" style={{fontWeight:900}}>🏭 選擇供應商</div><div className="card-body"><div className="search-input-wrap" style={{marginBottom:12}}><Search size={19}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋供應商..." style={{padding:'12px 14px 12px 44px',width:'100%',height:50,fontSize:17,fontWeight:600,borderRadius:10}}/></div>{loading?<div className="empty-state">讀取中...</div>:visibleSuppliers.length===0?<div className="empty-state">目前沒有待付款資料</div>:visibleSuppliers.map(g=><button key={g.supplier} onClick={()=>chooseSupplier(g.supplier)} style={{width:'100%',textAlign:'left',padding:'11px 12px',marginBottom:7,borderRadius:10,border:`2px solid ${selectedSupplier===g.supplier?'var(--indigo)':'var(--border)'}`,background:selectedSupplier===g.supplier?'var(--indigo-light)':'var(--surface)',cursor:'pointer',fontFamily:'inherit'}}><div style={{fontWeight:900}}>{g.supplier}</div><div style={{fontSize:12,marginTop:4,color:'var(--text-secondary)'}}>可付款 <strong style={{color:'#b45309'}}>{money(g.ready)}</strong>{Number(g.waiting)>0&&<>　等待條件 {money(g.waiting)}</>}　<span style={{color:'var(--text-muted)'}}>{g.count} 筆</span></div></button>)}</div></div>

      <div>{!selectedSupplier?<div className="card"><div className="empty-state" style={{padding:50}}>請先選擇左側供應商</div></div>:<>
        <div className="card" style={{marginBottom:14}}><div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap',alignItems:'center'}}><strong>{selectedSupplier}｜待付款明細</strong><div style={{display:'flex',gap:6}}><button className="btn btn-sm btn-ghost" disabled={detailsLoading} onClick={selectAll}>全部勾選</button><button className="btn btn-sm btn-ghost" disabled={detailsLoading} onClick={clearAll}>清除</button></div></div><div className="table-container"><table><thead><tr><th></th><th>客戶 / 商品</th><th>付款條件</th><th>到貨</th><th>成本</th><th>已付</th><th>待付</th></tr></thead><tbody>{detailsLoading&&<tr><td colSpan={7} style={{textAlign:'center',padding:26}}>明細讀取中...</td></tr>}{!detailsLoading&&supplierLines.map(l=><tr key={l.key} style={{opacity:l.isEligible?1:.55}}><td><input type="checkbox" disabled={!l.isEligible} checked={selected.includes(l.key)} onChange={()=>toggle(l.key)}/></td><td><div style={{fontWeight:800}}>{l.product_name} ×{l.qty} {l.isStockPurchase&&<span className="badge badge-violet">現貨進貨</span>}</div><div style={{fontSize:11,color:'var(--indigo)',fontWeight:700}}>{l.spec}</div><div style={{fontSize:11,color:'var(--text-muted)'}}>{l.customer_name}</div></td><td><span className={`badge ${l.term==='order'?'badge-indigo':l.term==='arrival'?'badge-amber':'badge-gray'}`}>{termLabel(l.term)}</span></td><td>{l.arrived?<span className="badge badge-emerald">已到貨</span>:<span className="badge badge-rose">未到貨</span>}</td><td>{money(l.cost)}</td><td>{money(l.paid)}</td><td style={{fontWeight:900,color:l.isEligible?'var(--rose)':'var(--text-muted)'}}>{money(l.outstanding)}</td></tr>)}{!detailsLoading&&!supplierLines.length&&<tr><td colSpan={7} style={{textAlign:'center',padding:24,color:'var(--text-muted)'}}>此供應商目前沒有待付款明細</td></tr>}</tbody></table></div></div>

        <div className="card"><div className="card-header" style={{fontWeight:900}}>💳 建立本次手動付款</div><div className="card-body"><div style={{background:'var(--amber-light)',padding:'10px 12px',borderRadius:10,fontSize:12,color:'#92400e',marginBottom:12}}>已選待付合計：<strong style={{fontSize:16}}>{money(selectedTotal)}</strong>。若實際匯款較少，可直接輸入較小金額，系統會依勾選順序分配並保留剩餘待付款。</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}><div className="form-group"><label>匯款日期</label><input type="date" value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}/></div><div className="form-group"><label>實際匯款金額</label><input type="number" min="1" max={selectedTotal||undefined} value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} /></div></div><div className="form-group"><label>備註</label><input value={note} onChange={e=>setNote(e.target.value)} placeholder="例：8月第一批貨款／銀行末五碼"/></div><button className="btn btn-primary" style={{width:'100%',justifyContent:'center',padding:'12px'}} disabled={saving||detailsLoading||!selectedLines.length} onClick={confirmPayment}><CreditCard size={16}/>{saving?'付款處理中...':'確認本次付款'}</button></div></div>
      </>}</div>
    </div>

    <div className="card" style={{marginTop:16}}><div className="card-header" style={{fontWeight:900}}>🧾 最近付款紀錄</div><div className="table-container"><table><thead><tr><th>付款日</th><th>供應商</th><th>金額</th><th>分配筆數</th><th>備註</th></tr></thead><tbody>{payments.map(p=><tr key={p.id}><td>{p.payment_date||'—'}</td><td style={{fontWeight:800}}>{p.supplier}</td><td style={{fontWeight:900,color:'var(--emerald)'}}>{money(p.amount)}</td><td>{Number(p.allocation_count||0)}</td><td>{p.note||'—'}</td></tr>)}{!payments.length&&<tr><td colSpan={5} style={{textAlign:'center',padding:24,color:'var(--text-muted)'}}>尚無付款紀錄</td></tr>}</tbody></table></div></div>
  </div>
}
