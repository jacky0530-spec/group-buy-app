import { useCallback, useEffect, useMemo, useState } from 'react'
import { SupplierPaymentsAPI } from '../lib/db'
import { neonPaymentsRuntime } from '../lib/neonRuntime'
import { useToast } from '../components/UI'
import { CreditCard, RefreshCw, Search, WalletCards, AlertTriangle } from 'lucide-react'

const money = v => `NT$${Math.round(Number(v || 0)).toLocaleString()}`
const today = () => new Date().toISOString().slice(0,10)
const termLabel = term => term === 'order' ? '訂貨即付款（到貨自動補登）' : term === 'arrival' ? '到貨後付款（自動）' : '手動付款'
const INPUT_STYLE={height:48,fontSize:16,padding:'10px 12px',borderRadius:10}

export default function SupplierPayments(){
  const toast=useToast()
  const[suppliers,setSuppliers]=useState([]),[payments,setPayments]=useState([]),[summary,setSummary]=useState({ready:0,waiting:0,unknownCost:0,allPaid:0,paidNotArrived:0})
  const[supplierLines,setSupplierLines]=useState([]),[loading,setLoading]=useState(true),[detailsLoading,setDetailsLoading]=useState(false)
  const[selectedSupplier,setSelectedSupplier]=useState(''),[search,setSearch]=useState(''),[selected,setSelected]=useState([])
  const[paymentDate,setPaymentDate]=useState(today()),[paymentAmount,setPaymentAmount]=useState(''),[note,setNote]=useState(''),[saving,setSaving]=useState(false)
  const[costEdits,setCostEdits]=useState({}),[costSaving,setCostSaving]=useState('')

  const load=useCallback(async()=>{
    setLoading(true)
    try{
      const result=await neonPaymentsRuntime('dashboard')
      setSuppliers(Array.isArray(result?.suppliers)?result.suppliers:[])
      setPayments(Array.isArray(result?.payments)?result.payments:[])
      setSummary(result?.summary||{ready:0,waiting:0,unknownCost:0,allPaid:0,paidNotArrived:0})
    }catch(e){toast('供應商付款資料載入失敗：'+e.message,'error')}
    finally{setLoading(false)}
  },[toast])
  useEffect(()=>{load()},[load])

  const visibleSuppliers=useMemo(()=>{
    const q=search.trim().toLowerCase()
    return suppliers.filter(g=>!q||String(g.supplier||'').toLowerCase().includes(q))
  },[suppliers,search])
  const readyLines=useMemo(()=>supplierLines.filter(l=>l.isEligible&&!l.needsCost),[supplierLines])
  const selectedLines=useMemo(()=>readyLines.filter(l=>selected.includes(l.key)),[readyLines,selected])
  const selectedTotal=selectedLines.reduce((s,l)=>s+Number(l.outstanding||0),0)

  const loadSupplier=useCallback(async(name,{autoSelect=false}={})=>{
    if(!name){setSupplierLines([]);setSelected([]);setCostEdits({});return[]}
    setDetailsLoading(true)
    try{
      const result=await neonPaymentsRuntime('supplier_payables',{supplier:name})
      const rows=Array.isArray(result?.rows)?result.rows:[]
      setSupplierLines(rows)
      setCostEdits(Object.fromEntries(rows.filter(l=>!l.isStockPurchase).map(l=>{
        const current=Number(l.unitCost||0),suggested=Number(l.suggestedUnitCost||0)
        return [l.key,current>0?String(current):(suggested>0?String(suggested):'')]
      })))
      if(autoSelect){
        const eligibleRows=rows.filter(l=>l.isEligible&&!l.needsCost)
        setSelected(eligibleRows.map(l=>l.key))
        const total=eligibleRows.reduce((s,l)=>s+Number(l.outstanding||0),0)
        setPaymentAmount(total?String(Math.round(total)):'')
      }
      return rows
    }catch(e){toast('供應商待付款明細載入失敗：'+e.message,'error');return[]}
    finally{setDetailsLoading(false)}
  },[toast])

  async function chooseSupplier(name){
    setSelectedSupplier(name);setSelected([]);setPaymentAmount('');setNote('');setSupplierLines([]);setCostEdits({})
    await loadSupplier(name,{autoSelect:true})
  }
  function toggle(key){setSelected(p=>p.includes(key)?p.filter(x=>x!==key):[...p,key])}
  function selectAll(){const keys=readyLines.map(l=>l.key);setSelected(keys);setPaymentAmount(String(Math.round(readyLines.reduce((s,l)=>s+Number(l.outstanding||0),0))))}
  function clearAll(){setSelected([]);setPaymentAmount('')}

  async function refresh(){
    await load()
    if(selectedSupplier) await loadSupplier(selectedSupplier,{autoSelect:false})
  }

  async function saveCost(line){
    if(line.isStockPurchase)return
    const unitCost=Number(costEdits[line.key]||0)
    if(!(unitCost>0)){toast('請輸入大於 0 的實際／暫估單位成本','error');return}
    setCostSaving(line.key)
    try{
      const response=await neonPaymentsRuntime('update_cost',{order_id:line.order_id,item_index:line.item_index,unit_cost:unitCost})
      const result=response?.result||{}
      toast(`✅ ${line.product_name} 單位成本已更新為 ${money(result.unit_cost||unitCost)}；原銷售月份毛利會依新成本重算`)
      setSelected([]);setPaymentAmount('')
      await load()
      await loadSupplier(selectedSupplier,{autoSelect:false})
    }catch(e){toast('成本更新失敗：'+e.message,'error')}
    finally{setCostSaving('')}
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
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:18}}><div><h2 style={{fontSize:22,fontWeight:800}}>供應商付款中心</h2><p style={{fontSize:13,color:'var(--text-secondary)',marginTop:3}}>待付款與統計由 Neon SQL 聚合；供應商實際付款日期只影響現金流，不作為銷貨成本認列月份。</p></div><button className="btn btn-ghost" onClick={refresh} disabled={loading||detailsLoading}><RefreshCw size={14}/>重新整理</button></div>

    <div style={{background:'linear-gradient(135deg,#eff6ff,#f5f3ff)',border:'1px solid #c7d2fe',borderRadius:12,padding:'12px 14px',marginBottom:16,fontSize:13,lineHeight:1.7,color:'#334155'}}><strong>📘 權責成本規則：</strong>商品售出／出貨的月份依訂單成本認列銷貨成本；供應商幾週或幾個月後才請款，不會把整筆成本壓到付款月份。帳單來時若金額不同，請先在下方修正「單位成本」再付款，系統會用新成本回算原銷售月份的毛利。</div>

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,marginBottom:18}}>
      <div className="stat-card" style={{background:'linear-gradient(135deg,#f59e0b,#d97706)'}}><div style={{fontSize:11,fontWeight:800}}>目前可手動付款</div><div style={{fontSize:22,fontWeight:900,marginTop:5}}>{money(summary.ready)}</div><WalletCards size={28} style={{position:'absolute',right:14,top:18,opacity:.25}}/></div>
      <div className="stat-card" style={{background:'linear-gradient(135deg,#64748b,#475569)'}}><div style={{fontSize:11,fontWeight:800}}>尚未達付款條件</div><div style={{fontSize:22,fontWeight:900,marginTop:5}}>{money(summary.waiting)}</div></div>
      <div className="stat-card" style={{background:'linear-gradient(135deg,#ef4444,#b91c1c)'}}><div style={{fontSize:11,fontWeight:800}}>成本待確認</div><div style={{fontSize:22,fontWeight:900,marginTop:5}}>{Number(summary.unknownCost||0)} 筆</div><AlertTriangle size={28} style={{position:'absolute',right:14,top:18,opacity:.25}}/></div>
      <div className="stat-card" style={{background:'linear-gradient(135deg,#10b981,#059669)'}}><div style={{fontSize:11,fontWeight:800}}>累計付款紀錄</div><div style={{fontSize:22,fontWeight:900,marginTop:5}}>{money(summary.allPaid)}</div></div>
      <div className="stat-card" style={{background:'linear-gradient(135deg,#3b82f6,#2563eb)'}}><div style={{fontSize:11,fontWeight:800}}>已付未到貨</div><div style={{fontSize:22,fontWeight:900,marginTop:5}}>{money(summary.paidNotArrived)}</div></div>
    </div>

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:14,alignItems:'start'}}>
      <div className="card"><div className="card-header" style={{fontWeight:900}}>🏭 選擇供應商</div><div className="card-body"><div className="search-input-wrap" style={{marginBottom:12}}><Search size={19}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋供應商..." style={{...INPUT_STYLE,paddingLeft:44,width:'100%'}}/></div>{loading?<div className="empty-state">讀取中...</div>:visibleSuppliers.length===0?<div className="empty-state">目前沒有待付款或成本待確認資料</div>:visibleSuppliers.map(g=><button key={g.supplier} onClick={()=>chooseSupplier(g.supplier)} style={{width:'100%',textAlign:'left',padding:'11px 12px',marginBottom:7,borderRadius:10,border:`2px solid ${selectedSupplier===g.supplier?'var(--indigo)':'var(--border)'}`,background:selectedSupplier===g.supplier?'var(--indigo-light)':'var(--surface)',cursor:'pointer',fontFamily:'inherit'}}><div style={{fontWeight:900}}>{g.supplier}</div><div style={{fontSize:12,marginTop:4,color:'var(--text-secondary)'}}>可付款 <strong style={{color:'#b45309'}}>{money(g.ready)}</strong>{Number(g.waiting)>0&&<>　等待條件 {money(g.waiting)}</>}{Number(g.unknownCount)>0&&<>　<span style={{color:'#b91c1c',fontWeight:800}}>成本待確認 {g.unknownCount} 筆</span></>}　<span style={{color:'var(--text-muted)'}}>{g.count} 筆</span></div></button>)}</div></div>

      <div>{!selectedSupplier?<div className="card"><div className="empty-state" style={{padding:50}}>請先選擇左側供應商</div></div>:<>
        <div className="card" style={{marginBottom:14}}><div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap',alignItems:'center'}}><strong>{selectedSupplier}｜待付款／成本確認明細</strong><div style={{display:'flex',gap:6}}><button className="btn btn-sm btn-ghost" disabled={detailsLoading} onClick={selectAll}>全部勾選</button><button className="btn btn-sm btn-ghost" disabled={detailsLoading} onClick={clearAll}>清除</button></div></div><div className="table-container"><table><thead><tr><th></th><th>客戶 / 商品</th><th>付款條件</th><th>到貨</th><th>單位成本 / 總成本</th><th>已付</th><th>待付</th></tr></thead><tbody>{detailsLoading&&<tr><td colSpan={7} style={{textAlign:'center',padding:26}}>明細讀取中...</td></tr>}{!detailsLoading&&supplierLines.map(l=><tr key={l.key} style={{opacity:l.needsCost?1:(l.isEligible?1:.55),background:l.needsCost?'#fff7ed':undefined}}><td><input type="checkbox" disabled={!l.isEligible||l.needsCost} checked={selected.includes(l.key)} onChange={()=>toggle(l.key)}/></td><td><div style={{fontWeight:800}}>{l.product_name} ×{l.qty} {l.isStockPurchase&&<span className="badge badge-violet">現貨進貨</span>} {l.needsCost&&<span className="badge badge-rose">成本待確認</span>}</div><div style={{fontSize:11,color:'var(--indigo)',fontWeight:700}}>{l.spec}</div><div style={{fontSize:11,color:'var(--text-muted)'}}>{l.customer_name}</div></td><td><span className={`badge ${l.term==='order'?'badge-indigo':l.term==='arrival'?'badge-amber':'badge-gray'}`}>{termLabel(l.term)}</span></td><td>{l.arrived?<span className="badge badge-emerald">已到貨</span>:<span className="badge badge-rose">未到貨</span>}</td><td style={{minWidth:205}}>{l.isStockPurchase?<><div style={{fontWeight:800}}>{money(l.unitCost)} / 件</div><div style={{fontSize:11,color:'var(--text-muted)'}}>總成本 {money(l.cost)}</div></>:<><div style={{display:'flex',gap:6,alignItems:'center'}}><input type="number" min="0.01" step="0.01" value={costEdits[l.key]??''} onChange={e=>setCostEdits(p=>({...p,[l.key]:e.target.value}))} style={{...INPUT_STYLE,width:112}}/><button className="btn btn-sm btn-ghost" disabled={costSaving===l.key} onClick={()=>saveCost(l)}>{costSaving===l.key?'儲存中':'儲存'}</button></div><div style={{fontSize:11,marginTop:4,color:l.needsCost?'#b91c1c':'var(--text-muted)'}}>{l.needsCost?(Number(l.suggestedUnitCost)>0?`商品目前成本建議 ${money(l.suggestedUnitCost)}；請確認後儲存`:'商品成本也是 0，請依帳單輸入'):`目前總成本 ${money(l.cost)}；帳單不同可直接修正`}</div></>}</td><td>{money(l.paid)}</td><td style={{fontWeight:900,color:l.needsCost?'#b91c1c':l.isEligible?'var(--rose)':'var(--text-muted)'}}>{l.needsCost?'先確認成本':money(l.outstanding)}</td></tr>)}{!detailsLoading&&!supplierLines.length&&<tr><td colSpan={7} style={{textAlign:'center',padding:24,color:'var(--text-muted)'}}>此供應商目前沒有待付款或成本待確認明細</td></tr>}</tbody></table></div></div>

        <div className="card"><div className="card-header" style={{fontWeight:900}}>💳 建立本次手動付款</div><div className="card-body"><div style={{background:'var(--amber-light)',padding:'10px 12px',borderRadius:10,fontSize:12,color:'#92400e',marginBottom:12}}>已選待付合計：<strong style={{fontSize:16}}>{money(selectedTotal)}</strong>。若實際匯款較少，可直接輸入較小金額，系統會依勾選順序分配並保留剩餘待付款。成本待確認的品項必須先儲存單位成本才能勾選付款。</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}><div className="form-group"><label>匯款日期</label><input type="date" value={paymentDate} onChange={e=>setPaymentDate(e.target.value)} style={INPUT_STYLE}/></div><div className="form-group"><label>實際匯款金額</label><input type="number" min="1" max={selectedTotal||undefined} value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} style={INPUT_STYLE}/></div></div><div className="form-group"><label>備註</label><input value={note} onChange={e=>setNote(e.target.value)} placeholder="例：9月貨款／12月收到帳單後付款" style={INPUT_STYLE}/></div><button className="btn btn-primary" style={{width:'100%',justifyContent:'center',padding:'12px'}} disabled={saving||detailsLoading||!selectedLines.length} onClick={confirmPayment}><CreditCard size={16}/>{saving?'付款處理中...':'確認本次付款'}</button></div></div>
      </>}</div>
    </div>

    <div className="card" style={{marginTop:16}}><div className="card-header" style={{fontWeight:900}}>🧾 最近付款紀錄</div><div className="table-container"><table><thead><tr><th>付款日</th><th>供應商</th><th>金額</th><th>分配筆數</th><th>備註</th></tr></thead><tbody>{payments.map(p=><tr key={p.id}><td>{p.payment_date||'—'}</td><td style={{fontWeight:800}}>{p.supplier}</td><td style={{fontWeight:900,color:'var(--emerald)'}}>{money(p.amount)}</td><td>{Number(p.allocation_count||0)}</td><td>{p.note||'—'}</td></tr>)}{!payments.length&&<tr><td colSpan={5} style={{textAlign:'center',padding:24,color:'var(--text-muted)'}}>尚無付款紀錄</td></tr>}</tbody></table></div></div>
  </div>
}