import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArchiveRestore, History, PackageCheck, Plus, RefreshCw, Search, Warehouse } from 'lucide-react'
import { ProductsAPI } from '../lib/db'
import { InventoryAPI, stockSpecLabel } from '../lib/inventory'
import { neonInventoryRuntime } from '../lib/neonRuntime'
import { useToast } from '../components/UI'
import QuantityInput from '../components/QuantityInput'

const blankSpec = () => ({ package:'', flavor:'', color:'', size:'' })
const movementLabel = type => ({ receive:'入庫', sale:'現貨出單', adjustment:'手動調整', restore:'取消還庫', reconcile:'校正' }[type] || type || '異動')

function SpecFields({ product, spec, onChange }) {
  if (!product) return null
  const style={height:40,minWidth:120}
  return <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
    {(product.price_options||[]).length>0&&<select value={spec.package||''} onChange={e=>onChange('package',e.target.value)} style={style}><option value="">組合／包裝</option>{product.price_options.map(o=><option key={o.label} value={o.label}>{o.label}</option>)}</select>}
    {(product.spec_flavors||[]).length>0&&<select value={spec.flavor||''} onChange={e=>onChange('flavor',e.target.value)} style={style}><option value="">口味</option>{product.spec_flavors.map(v=><option key={v} value={v}>{v}</option>)}</select>}
    {['color_size','color_free','color_only'].includes(product.spec_mode)&&<select value={spec.color||''} onChange={e=>onChange('color',e.target.value)} style={style}><option value="">顏色</option>{(product.spec_colors||[]).map(v=><option key={v} value={v}>{v}</option>)}</select>}
    {['color_size','size_only'].includes(product.spec_mode)&&<select value={spec.size||''} onChange={e=>onChange('size',e.target.value)} style={style}><option value="">尺寸</option>{(product.spec_sizes||[]).map(v=><option key={v} value={v}>{v}</option>)}</select>}
  </div>
}

export default function StockInventory(){
  const toast=useToast()
  const [stock,setStock]=useState([])
  const [extras,setExtras]=useState([])
  const [movements,setMovements]=useState([])
  const [products,setProducts]=useState([])
  const [search,setSearch]=useState('')
  const [productSearch,setProductSearch]=useState('')
  const [product,setProduct]=useState(null)
  const [spec,setSpec]=useState(blankSpec())
  const [qty,setQty]=useState(1)
  const [note,setNote]=useState('')
  const [saving,setSaving]=useState(false)

  const load=useCallback(async()=>{
    try{
      const [s,e,p,m]=await Promise.all([
        InventoryAPI.listStock(),
        InventoryAPI.listExtras(),
        ProductsAPI.list(),
        neonInventoryRuntime('list_movements').catch(()=>({rows:[]})),
      ])
      setStock(s);setExtras(e);setProducts(p);setMovements(Array.isArray(m?.rows)?m.rows:[])
    }catch(err){toast('現貨資料載入失敗：'+err.message,'error')}
  },[toast])
  useEffect(()=>{load()},[load])

  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase()
    if(!q)return stock
    return stock.filter(r=>[r.product_name,r.supplier,r.spec_label].some(v=>String(v||'').toLowerCase().includes(q)))
  },[stock,search])
  const productMatches=useMemo(()=>{
    const q=productSearch.trim().toLowerCase()
    return products.filter(p=>!q||String(p.name||'').toLowerCase().includes(q)).slice(0,20)
  },[products,productSearch])
  const total=filtered.reduce((s,r)=>s+Number(r.available_qty||0),0)

  async function createExtra(){
    if(!product)return toast('請先選擇商品','error')
    setSaving(true)
    try{
      await InventoryAPI.createExtraPurchase({product,spec,qty,note})
      toast(`已新增額外叫貨 ${qty} 件 ✓`)
      setProduct(null);setProductSearch('');setSpec(blankSpec());setQty(1);setNote('');await load()
    }catch(err){toast('新增額外叫貨失敗：'+err.message,'error')}
    finally{setSaving(false)}
  }
  async function receive(row){
    try{const r=await InventoryAPI.receiveExtraPurchase(row.id);toast(`已入庫 ${r.received} 件，現貨 ${r.available} 件 ✓`);await load()}
    catch(err){toast('入庫失敗：'+err.message,'error')}
  }
  async function adjust(row,value){
    const n=Number(value)
    if(!Number.isInteger(n)||n<0||n===Number(row.available_qty||0))return
    try{await InventoryAPI.adjustAvailable(row.id,n,'後台手動調整');toast('現貨數量已更新 ✓');await load()}
    catch(err){toast('調整失敗：'+err.message,'error')}
  }

  return <div className="animate-fade">
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:18}}><div><h2 style={{fontSize:22,fontWeight:900}}>現貨庫存</h2><p style={{fontSize:13,color:'var(--text-secondary)',marginTop:3}}>額外叫貨入庫後成為可售現貨；現貨開單會直接扣庫存。Neon 同步保留每次庫存異動流水。</p></div><button className="btn btn-ghost" onClick={load}><RefreshCw size={14}/>重新整理</button></div>

    <div className="card" style={{marginBottom:16}}><div className="card-header"><strong><Plus size={15}/> 新增額外叫貨</strong></div><div className="card-body"><div className="search-input-wrap" style={{maxWidth:520,marginBottom:8}}><Search size={14}/><input value={productSearch} onChange={e=>setProductSearch(e.target.value)} placeholder="搜尋商品..." style={{paddingLeft:32}}/></div>{productSearch&&<div style={{border:'1px solid var(--border)',borderRadius:10,maxHeight:180,overflowY:'auto',marginBottom:10}}>{productMatches.map(p=><button type="button" key={p.id} onClick={()=>{setProduct(p);setProductSearch(p.name);setSpec(blankSpec())}} style={{display:'flex',justifyContent:'space-between',width:'100%',padding:'10px 12px',border:0,borderBottom:'1px solid var(--border)',background:product?.id===p.id?'#eff6ff':'#fff',cursor:'pointer'}}><strong>{p.name}</strong><span style={{color:'#2563eb'}}>{p.supplier||'未設定廠商'}</span></button>)}</div>}{product&&<div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}><SpecFields product={product} spec={spec} onChange={(k,v)=>setSpec(s=>({...s,[k]:v}))}/><span>額外數量</span><QuantityInput value={qty} min={1} onChange={setQty} style={{width:110,height:44,fontSize:18,fontWeight:900,textAlign:'center'}}/><input value={note} onChange={e=>setNote(e.target.value)} placeholder="備註" style={{minWidth:180,flex:1}}/><button className="btn btn-primary" disabled={saving} onClick={createExtra}>{saving?'建立中...':'建立額外叫貨'}</button></div>}</div></div>

    <div className="card" style={{marginBottom:16}}><div className="card-header"><strong><PackageCheck size={15}/> 待入庫的額外叫貨</strong></div><div className="table-container"><table><thead><tr><th>商品</th><th>供應廠商</th><th>規格</th><th>叫貨</th><th>已入庫</th><th>操作</th></tr></thead><tbody>{extras.filter(x=>x.status!=='received').length===0&&<tr><td colSpan={6} style={{textAlign:'center',padding:24,color:'var(--text-muted)'}}>目前沒有待入庫的額外叫貨</td></tr>}{extras.filter(x=>x.status!=='received').map(r=><tr key={r.id}><td><strong>{r.product_name}</strong></td><td style={{color:'#2563eb',fontWeight:900}}>{r.supplier||'未設定'}</td><td>{r.spec_label||stockSpecLabel(r.spec)}</td><td>{r.ordered_qty}</td><td>{r.received_qty||0}</td><td><button className="btn btn-sm btn-primary" onClick={()=>receive(r)}><ArchiveRestore size={13}/>全部到貨並轉現貨</button></td></tr>)}</tbody></table></div></div>

    <div className="card" style={{marginBottom:16}}><div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}><strong><Warehouse size={15}/> 可售現貨</strong><span style={{fontSize:12,color:'var(--text-muted)'}}>目前共 {total} 件</span></div><div className="card-body"><div className="search-input-wrap" style={{maxWidth:520,marginBottom:12}}><Search size={14}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋商品／規格／供應商" style={{paddingLeft:32}}/></div><div className="table-container"><table><thead><tr><th>商品</th><th>供應廠商</th><th>規格</th><th>可售現貨</th><th>手動調整</th></tr></thead><tbody>{filtered.length===0&&<tr><td colSpan={5} style={{textAlign:'center',padding:28,color:'var(--text-muted)'}}>目前沒有符合的現貨</td></tr>}{filtered.map(r=><tr key={r.id}><td><strong>{r.product_name}</strong></td><td style={{color:'#2563eb',fontWeight:900}}>{r.supplier||'未設定'}</td><td>{r.spec_label||stockSpecLabel(r.spec)}</td><td><strong style={{fontSize:18,color:Number(r.available_qty||0)>0?'#059669':'#94a3b8'}}>{r.available_qty||0}</strong></td><td><input type="number" min="0" defaultValue={r.available_qty||0} onBlur={e=>adjust(r,e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} style={{width:90,textAlign:'center',fontWeight:900}}/></td></tr>)}</tbody></table></div></div></div>

    <div className="card"><div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}><strong><History size={15}/> 庫存異動流水</strong><span style={{fontSize:12,color:'var(--text-muted)'}}>最近 {movements.length} 筆</span></div><div className="table-container"><table><thead><tr><th>時間</th><th>商品</th><th>類型</th><th>增減</th><th>異動後</th><th>關聯</th><th>備註</th></tr></thead><tbody>{movements.length===0&&<tr><td colSpan={7} style={{textAlign:'center',padding:26,color:'var(--text-muted)'}}>尚無 Neon 庫存流水；下一次入庫、出單或手動調整後會開始記錄。</td></tr>}{movements.map(r=><tr key={r.id}><td style={{whiteSpace:'nowrap',fontSize:12}}>{r.created_at?new Date(r.created_at).toLocaleString('zh-TW'):'—'}</td><td><strong>{r.product_name||r.product_id}</strong></td><td><span className="badge badge-gray">{movementLabel(r.transaction_type)}</span></td><td><strong style={{color:Number(r.qty_change)>=0?'#059669':'#dc2626'}}>{Number(r.qty_change)>=0?'+':''}{r.qty_change}</strong></td><td><strong>{r.balance_after}</strong></td><td style={{fontSize:11,color:'var(--text-secondary)'}}>{r.order_id?`訂單 ${r.order_id}`:r.extra_id?`叫貨 ${r.extra_id}`:'—'}</td><td style={{fontSize:12}}>{r.note||'—'}</td></tr>)}</tbody></table></div></div>
  </div>
}
