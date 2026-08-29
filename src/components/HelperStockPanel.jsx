import { useCallback, useEffect, useMemo, useState } from 'react'
import { PackageCheck, Search, ShoppingCart } from 'lucide-react'
import { InventoryAPI, stockSpecLabel } from '../lib/inventory'
import { neonRuntime } from '../lib/neonRuntime'
import { HelperAPI } from '../lib/helper'
import { getCustomerPhoneLast2 } from '../lib/customerSearch'
import { useAuth } from './AuthGuard'
import { useToast } from './UI'
import QuantityInput from './QuantityInput'

const SEARCH_INPUT_STYLE={width:'100%',minHeight:52,fontSize:16,paddingTop:12,paddingBottom:12,borderRadius:10}

export default function HelperStockPanel(){
  const { user,account }=useAuth()
  const toast=useToast()
  const [stock,setStock]=useState([])
  const [stockLoading,setStockLoading]=useState(true)
  const [customers,setCustomers]=useState([])
  const [customerSearching,setCustomerSearching]=useState(false)
  const [search,setSearch]=useState('')
  const [customerSearch,setCustomerSearch]=useState('')
  const [customer,setCustomer]=useState(null)
  const [selected,setSelected]=useState(null)
  const [qty,setQty]=useState(1)
  const [note,setNote]=useState('')
  const [saving,setSaving]=useState(false)

  const loadStock=useCallback(async(q='')=>{
    setStockLoading(true)
    try{
      const result=await neonRuntime('stock_search',{search:String(q||'').trim(),limit:80})
      setStock(Array.isArray(result?.rows)?result.rows:[])
    }catch(err){toast('現貨資料載入失敗：'+err.message,'error')}
    finally{setStockLoading(false)}
  },[toast])

  useEffect(()=>{
    let active=true
    const timer=window.setTimeout(async()=>{
      if(!active)return
      await loadStock(search)
    },search.trim()?220:0)
    return()=>{active=false;window.clearTimeout(timer)}
  },[search,loadStock])

  useEffect(()=>{
    const q=customerSearch.trim()
    if(!q||customer){setCustomers([]);setCustomerSearching(false);return undefined}
    let active=true
    setCustomerSearching(true)
    const timer=window.setTimeout(async()=>{
      try{const rows=await HelperAPI.searchCustomers(q,20);if(active)setCustomers(rows)}
      catch(err){if(active)toast('客戶搜尋失敗：'+err.message,'error')}
      finally{if(active)setCustomerSearching(false)}
    },220)
    return()=>{active=false;window.clearTimeout(timer)}
  },[customerSearch,customer,toast])

  const custs=useMemo(()=>customers.slice(0,20),[customers])

  async function create(){
    if(!customer)return toast('請先選擇客戶','error')
    if(!selected)return toast('請先選擇現貨商品','error')
    setSaving(true)
    try{
      await InventoryAPI.createHelperStockOrder({uid:user.uid,displayName:account?.display_name||user.email||'',customer:{...customer,phone_last2:getCustomerPhoneLast2(customer)},inventory:selected,qty,note})
      toast(`現貨訂單已建立 ${qty} 件，庫存已扣除 ✓`)
      setSelected(null);setQty(1);setNote('')
      await loadStock(search)
    }catch(err){toast('現貨開單失敗：'+err.message,'error')}
    finally{setSaving(false)}
  }

  return <div>
    <div style={{marginBottom:14}}><strong style={{fontSize:18}}>現貨查詢／開單</strong><div style={{fontSize:12,color:'var(--text-muted)',marginTop:3}}>現貨與客戶皆由 Neon SQL 即時搜尋；只回傳符合條件的可售庫存。</div></div>
    <div className="card" style={{marginBottom:12}}><div className="card-body"><label style={{fontSize:12,fontWeight:800}}>1. 選擇客戶</label><input value={customerSearch} onChange={e=>{setCustomerSearch(e.target.value);setCustomer(null)}} placeholder="姓名／末碼／備註" style={{...SEARCH_INPUT_STYLE,marginTop:8}}/>{customerSearch&&!customer&&<div style={{border:'1px solid var(--border)',borderRadius:8,maxHeight:220,overflowY:'auto',marginTop:6}}>{customerSearching?<div style={{padding:'12px 14px',color:'var(--text-muted)'}}>SQL 搜尋中...</div>:custs.length?custs.map(c=><button key={c.id} onClick={()=>{setCustomer(c);setCustomerSearch(c.name)}} style={{display:'block',width:'100%',textAlign:'left',padding:'12px 14px',border:0,borderBottom:'1px solid var(--border)',background:'#fff'}}><strong>{c.name}</strong> <span style={{fontSize:11,color:'var(--text-muted)'}}>末碼 {getCustomerPhoneLast2(c)||'—'}</span>{c.note&&<div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>備註：{c.note}</div>}</button>):<div style={{padding:'12px 14px',color:'var(--text-muted)'}}>找不到符合客戶</div>}</div>}</div></div>
    <div className="card" style={{marginBottom:12}}><div className="card-body"><label style={{fontSize:12,fontWeight:800}}>2. 搜尋現貨商品</label><div className="search-input-wrap" style={{marginTop:8,width:'100%',maxWidth:'100%'}}><Search size={18}/><input value={search} onChange={e=>{setSearch(e.target.value);setSelected(null)}} placeholder="輸入商品／規格／供應商搜尋" style={{...SEARCH_INPUT_STYLE,paddingLeft:38}}/></div>{stockLoading&&<div style={{padding:'12px 0',color:'var(--text-muted)'}}>SQL 查詢現貨中...</div>}<div style={{display:'grid',gap:8,marginTop:12}}>{!stockLoading&&stock.length===0&&<div style={{padding:18,textAlign:'center',color:'var(--text-muted)'}}>沒有符合的可售現貨</div>}{stock.map(r=><button key={r.id} onClick={()=>setSelected(r)} style={{textAlign:'left',padding:'12px 14px',borderRadius:10,border:`2px solid ${selected?.id===r.id?'#059669':'var(--border)'}`,background:selected?.id===r.id?'#ecfdf5':'#fff'}}><div style={{display:'flex',justifyContent:'space-between',gap:10}}><strong>{r.product_name}</strong><strong style={{color:'#059669'}}>現貨 {r.available_qty}</strong></div><div style={{fontSize:12,color:'#2563eb',fontWeight:800,marginTop:3}}>{stockSpecLabel(r.spec)}</div><div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>供應商：{r.supplier||'未設定'}</div></button>)}</div></div></div>
    {selected&&<div className="card"><div className="card-header"><strong><PackageCheck size={14}/> 已選：{selected.product_name}</strong></div><div className="card-body"><div style={{fontSize:13,color:'#2563eb',fontWeight:900,marginBottom:8}}>{stockSpecLabel(selected.spec)}｜可售 {selected.available_qty} 件</div><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><span>數量</span><QuantityInput value={qty} min={1} max={Number(selected.available_qty||1)} onChange={setQty} style={{width:120,height:46,fontSize:18,fontWeight:900,textAlign:'center'}}/><input value={note} onChange={e=>setNote(e.target.value)} placeholder="商品備註" style={{flex:1,minWidth:180,minHeight:46}}/><button className="btn btn-primary" disabled={saving} onClick={create}><ShoppingCart size={14}/>{saving?'建立中...':'建立現貨訂單'}</button></div></div></div>}
  </div>
}
