import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Archive, Truck, ReceiptText, BadgeDollarSign } from 'lucide-react'
import { ExpensesAPI, EXPENSE_TYPES } from '../lib/expenses'
import { neonRuntime } from '../lib/neonRuntime'
import { useToast } from '../components/UI'

const money=value=>`NT$${Math.round(Number(value||0)).toLocaleString()}`

export default function ExpensesSql(){
  const toast=useToast()
  const currentMonth=useMemo(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`},[])
  const [rows,setRows]=useState([])
  const [stats,setStats]=useState({shipping:0,other:0,discount:0,net:0,count:0})
  const [month,setMonth]=useState(currentMonth)
  const [supplier,setSupplier]=useState('')
  const [type,setType]=useState('shipping')
  const [amount,setAmount]=useState('')
  const [note,setNote]=useState('')
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)

  const load=useCallback(async()=>{
    setLoading(true)
    try{
      const result=await neonRuntime('expense_month',{month})
      setRows(Array.isArray(result?.rows)?result.rows:[])
      setStats({shipping:Number(result?.stats?.shipping||0),other:Number(result?.stats?.other||0),discount:Number(result?.stats?.discount||0),net:Number(result?.stats?.net||0),count:Number(result?.stats?.count||0)})
    }catch(err){toast('其他費用載入失敗：'+err.message,'error')}
    finally{setLoading(false)}
  },[month,toast])
  useEffect(()=>{load()},[load])

  async function addRow(){
    if(!month||!supplier.trim()||!amount||Number(amount)<=0){toast('請填寫月份、廠商與大於 0 的金額','error');return}
    setSaving(true)
    try{await ExpensesAPI.create({month,supplier,type,amount,note});setSupplier('');setAmount('');setNote('');toast('其他費用已新增 ✓');await load()}
    catch(err){toast('新增失敗：'+err.message,'error')}finally{setSaving(false)}
  }
  async function archiveRow(row){
    if(!confirm(`確定移除「${row.supplier}」這筆${EXPENSE_TYPES.find(t=>t.id===row.type)?.label||'費用'}？`))return
    try{await ExpensesAPI.archive(row.id);toast('已移除');await load()}
    catch(err){toast('移除失敗：'+err.message,'error')}
  }

  return <div className="animate-fade">
    <div style={{marginBottom:20}}><h2 style={{fontSize:22,fontWeight:800}}>每月其他費用</h2><p style={{color:'var(--text-secondary)',fontSize:13,marginTop:2}}>明細與統計由 Neon SQL 直接依月份計算，不再下載全部歷史費用。</p></div>

    <div className="card" style={{marginBottom:16}}><div className="card-header" style={{fontWeight:800}}>新增費用 / 折讓</div><div className="card-body">
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12}}>
        <div className="form-group"><label>月份 *</label><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div>
        <div className="form-group"><label>廠商 *</label><input value={supplier} onChange={e=>setSupplier(e.target.value)} placeholder="例如：7號倉儲"/></div>
        <div className="form-group"><label>類型 *</label><select value={type} onChange={e=>setType(e.target.value)}>{EXPENSE_TYPES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
        <div className="form-group"><label>金額 *</label><input type="number" min="0" inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0"/></div>
      </div>
      <div className="form-group"><label>備註</label><input value={note} onChange={e=>setNote(e.target.value)} placeholder="例如：本月冷凍運費、缺貨折讓..."/></div>
      <button className="btn btn-primary" disabled={saving} onClick={addRow}><Plus size={14}/>{saving?'儲存中...':'新增一筆'}</button>
    </div></div>

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:16}}>
      <div style={{background:'var(--amber-light)',padding:14,borderRadius:10}}><div style={{fontSize:12,fontWeight:700,color:'#b45309'}}>運費</div><strong style={{fontSize:21}}>{money(stats.shipping)}</strong></div>
      <div style={{background:'var(--rose-light)',padding:14,borderRadius:10}}><div style={{fontSize:12,fontWeight:700,color:'var(--rose)'}}>其他費用</div><strong style={{fontSize:21}}>{money(stats.other)}</strong></div>
      <div style={{background:'var(--emerald-light)',padding:14,borderRadius:10}}><div style={{fontSize:12,fontWeight:700,color:'var(--emerald)'}}>退費折讓</div><strong style={{fontSize:21}}>− {money(stats.discount)}</strong></div>
      <div style={{background:'var(--sky-light)',padding:14,borderRadius:10}}><div style={{fontSize:12,fontWeight:700,color:'#0369a1'}}>其他費用淨額</div><strong style={{fontSize:21}}>{money(stats.net)}</strong></div>
    </div>

    <div className="card"><div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><strong>{month} 明細</strong><span style={{fontSize:12,color:'var(--text-muted)'}}>{loading?'讀取中...':`${stats.count} 筆`}</span></div><div className="table-container"><table><thead><tr><th>廠商</th><th>類型</th><th>金額</th><th>備註</th><th style={{textAlign:'right'}}>操作</th></tr></thead><tbody>{!loading&&rows.length===0&&<tr><td colSpan={5} style={{textAlign:'center',padding:30,color:'var(--text-muted)'}}>本月尚未輸入其他費用</td></tr>}{rows.map(row=>{const meta=EXPENSE_TYPES.find(t=>t.id===row.type);const Icon=row.type==='shipping'?Truck:row.type==='discount'?BadgeDollarSign:ReceiptText;return <tr key={row.id}><td style={{fontWeight:700}}>{row.supplier}</td><td><Icon size={14} style={{verticalAlign:'middle',marginRight:5}}/>{meta?.label||row.type}</td><td style={{fontWeight:800,color:row.type==='discount'?'var(--emerald)':'var(--rose)'}}>{row.type==='discount'?'− ':''}{money(row.amount)}</td><td>{row.note||'—'}</td><td style={{textAlign:'right'}}><button className="btn btn-ghost btn-sm" onClick={()=>archiveRow(row)}><Archive size={13}/>移除</button></td></tr>})}</tbody></table></div></div>
  </div>
}
