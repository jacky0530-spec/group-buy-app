import { useCallback, useEffect, useState } from 'react'
import { ArchiveRestore, History, PackageCheck, Pencil, Plus, RefreshCw, Search, Trash2, Warehouse } from 'lucide-react'
import { InventoryAPI, stockSpecLabel } from '../lib/inventory'
import { neonHelperAdminRuntime, neonInventoryRuntime } from '../lib/neonRuntime'
import { useToast } from '../components/UI'
import QuantityInput from '../components/QuantityInput'

const PAGE_SIZE=100
const blankSpec=()=>({package:'',flavor:'',color:'',size:''})
const movementLabel=type=>({extra_receive:'入庫',stock_sale:'現貨出單',manual_adjust:'手動調整',return:'取消還庫',correction:'校正',receive:'入庫',sale:'現貨出單',adjustment:'手動調整',restore:'取消還庫',reconsume:'恢復訂單重扣'}[type]||type||'異動')

function SpecFields({product,spec,onChange}){
  if(!product)return null
  const style={height:42,minWidth:130}
  return <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
    {(product.price_options||[]).length>0&&<select value={spec.package||''} onChange={e=>onChange('package',e.target.value)} style={style}><option value="">組合／包裝 *</option>{product.price_options.map(o=><option key={o.label} value={o.label}>{o.label}</option>)}</select>}
    {(product.spec_flavors||[]).length>0&&<select value={spec.flavor||''} onChange={e=>onChange('flavor',e.target.value)} style={style}><option value="">口味／品種 *</option>{product.spec_flavors.map(v=><option key={v} value={v}>{v}</option>)}</select>}
    {['color_size','color_free','color_only'].includes(product.spec_mode)&&<select value={spec.color||''} onChange={e=>onChange('color',e.target.value)} style={style}><option value="">顏色 *</option>{(product.spec_colors||[]).map(v=><option key={v} value={v}>{v}</option>)}</select>}
    {['color_size','size_only'].includes(product.spec_mode)&&<select value={spec.size||''} onChange={e=>onChange('size',e.target.value)} style={style}><option value="">尺寸 *</option>{(product.spec_sizes||[]).map(v=><option key={v} value={v}>{v}</option>)}</select>}
  </div>
}
function validateSpec(product,spec){
  if(!product)return '請先選擇商品'
  if((product.price_options||[]).length&&!spec.package)return '請選擇組合／包裝'
  if(['color_size','color_only','color_free'].includes(product.spec_mode)&&!spec.color)return '請選擇顏色'
  if(['color_size','size_only'].includes(product.spec_mode)&&!spec.size)return '請選擇尺寸'
  if((product.spec_flavors||[]).length&&!spec.flavor)return '請選擇口味／品種'
  return ''
}
function selectedCost(product,spec){
  const option=(product?.price_options||[]).find(o=>String(o.label||'').trim()===String(spec?.package||'').trim())
  if(option&&option.cost!==''&&option.cost!=null&&Number.isFinite(Number(option.cost)))return Number(option.cost)
  return Number(product?.cost||0)
}

export default function StockInventoryFast(){
  const toast=useToast()
  const [stock,setStock]=useState([])
  const [extras,setExtras]=useState([])
  const [movements,setMovements]=useState([])
  const [search,setSearch]=useState('')
  const [totalQty,setTotalQty]=useState(0)
  const [totalCount,setTotalCount]=useState(0)
  const [hasMore,setHasMore]=useState(false)
  const [loading,setLoading]=useState(true)
  const [loadingMore,setLoadingMore]=useState(false)
  const [productSearch,setProductSearch]=useState('')
  const [productMatches,setProductMatches]=useState([])
  const [product,setProduct]=useState(null)
  const [spec,setSpec]=useState(blankSpec())
  const [qty,setQty]=useState(1)
  const [note,setNote]=useState('')
  const [saving,setSaving]=useState(false)
  const [editingExtraId,setEditingExtraId]=useState('')
  const [editExtra,setEditExtra]=useState(null)
  const [extraBusyId,setExtraBusyId]=useState('')

  const loadStock=useCallback(async({append=false}={})=>{
    append?setLoadingMore(true):setLoading(true)
    try{
      const result=await neonInventoryRuntime('stock_query',{search:search.trim(),pageSize:PAGE_SIZE,offset:append?stock.length:0})
      const rows=Array.isArray(result?.rows)?result.rows:[]
      setStock(prev=>append?[...prev,...rows]:rows)
      setTotalQty(Number(result?.totalQty||0));setTotalCount(Number(result?.totalCount||0));setHasMore(result?.hasMore===true)
    }catch(err){toast('現貨資料載入失敗：'+err.message,'error')}
    finally{append?setLoadingMore(false):setLoading(false)}
  },[search,stock.length,toast])
  const loadSupport=useCallback(async()=>{
    try{const result=await neonInventoryRuntime('stock_support',{movementLimit:100});setExtras(Array.isArray(result?.extras)?result.extras:[]);setMovements(Array.isArray(result?.movements)?result.movements:[])}
    catch(err){toast('庫存輔助資料載入失敗：'+err.message,'error')}
  },[toast])
  const refresh=useCallback(async()=>{await Promise.all([loadStock({append:false}),loadSupport()])},[loadStock,loadSupport])

  useEffect(()=>{const timer=window.setTimeout(()=>loadStock({append:false}),search.trim()?250:0);return()=>window.clearTimeout(timer)},[search])
  useEffect(()=>{loadSupport()},[loadSupport])
  useEffect(()=>{
    if(!productSearch.trim()||product){setProductMatches([]);return undefined}
    let cancelled=false
    const timer=window.setTimeout(async()=>{try{const result=await neonHelperAdminRuntime({action:'product_query',includeArchived:false,search:productSearch.trim(),category:'all',pageSize:20,offset:0});if(!cancelled)setProductMatches(Array.isArray(result?.rows)?result.rows:[])}catch(err){if(!cancelled)toast('商品搜尋失敗：'+err.message,'error')}},250)
    return()=>{cancelled=true;window.clearTimeout(timer)}
  },[productSearch,product,toast])

  const specError=product?validateSpec(product,spec):''
  const unitCost=product?selectedCost(product,spec):0

  async function createExtra(){
    if(!product)return toast('請先選擇商品','error')
    const error=validateSpec(product,spec);if(error)return toast(error,'error')
    const amount=Number(qty);if(!Number.isInteger(amount)||amount<1)return toast('額外叫貨數量必須是 1 以上整數','error')
    setSaving(true)
    try{await InventoryAPI.createExtraPurchase({product,spec,qty:amount,note});toast(`已新增額外叫貨 ${amount} 件 ✓`);setProduct(null);setProductSearch('');setProductMatches([]);setSpec(blankSpec());setQty(1);setNote('');await loadSupport()}
    catch(err){toast('新增額外叫貨失敗：'+err.message,'error')}finally{setSaving(false)}
  }
  async function receive(row){
    try{const result=await neonInventoryRuntime('receive_extra',{extra_id:row.id,note:row.note||'額外叫貨入庫'});const r=result?.result||{};toast(`已入庫 ${Number(r.received||0)} 件，現貨 ${Number(r.available_qty||0)} 件 ✓`);await refresh()}
    catch(err){toast('入庫失敗：'+err.message,'error')}
  }
  async function adjust(row,value){
    const n=Number(value);if(!Number.isInteger(n)||n<0||n===Number(row.available_qty||0))return
    try{await neonInventoryRuntime('set_stock_by_id',{inventory_id:row.neon_id,available_qty:n,note:'後台手動調整'});toast('現貨數量已更新 ✓');await loadStock({append:false});await loadSupport()}
    catch(err){toast('調整失敗：'+err.message,'error')}
  }
  function beginEditExtra(row){setEditingExtraId(row.id);setEditExtra({ordered_qty:Number(row.ordered_qty||0),unit_cost:Number(row.unit_cost||0),note:String(row.note||'')})}
  function cancelEditExtra(){setEditingExtraId('');setEditExtra(null)}
  async function saveExtra(row){
    if(!editExtra)return
    const received=Math.max(0,Number(row.received_qty||0)),ordered=Number(editExtra.ordered_qty),cost=Number(editExtra.unit_cost)
    if(received===0&&(!Number.isInteger(ordered)||ordered<1))return toast('叫貨數量必須是 1 以上整數','error')
    if(received===0&&(!Number.isFinite(cost)||cost<0))return toast('單位成本不可小於 0','error')
    setExtraBusyId(row.id)
    try{const next={...row,note:String(editExtra.note||'').trim(),updated_at:new Date().toISOString()};if(received===0){next.ordered_qty=ordered;next.unit_cost=cost}await neonInventoryRuntime('sync_extra',{row:next});toast('額外叫貨已修改 ✓');cancelEditExtra();await loadSupport()}
    catch(err){toast('修改額外叫貨失敗：'+err.message,'error')}finally{setExtraBusyId('')}
  }
  async function deleteExtra(row){
    const received=Math.max(0,Number(row.received_qty||0));if(received>0)return toast('已有入庫紀錄，不能刪除此筆叫貨','error')
    if(!window.confirm(`確定刪除「${row.product_name}」這筆額外叫貨？`))return
    setExtraBusyId(row.id)
    try{await neonInventoryRuntime('sync_extra',{row:{...row,status:'cancelled',updated_at:new Date().toISOString()}});toast('額外叫貨已刪除 ✓');if(editingExtraId===row.id)cancelEditExtra();await loadSupport()}
    catch(err){toast('刪除額外叫貨失敗：'+err.message,'error')}finally{setExtraBusyId('')}
  }

  return <div className="animate-fade">
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:18}}><div><h2 style={{fontSize:22,fontWeight:900}}>現貨庫存</h2><p style={{fontSize:13,color:'var(--text-secondary)',marginTop:3}}>庫存清單、搜尋與總數改由 Neon SQL 計算；寫入仍沿用原子庫存交易。</p></div><button className="btn btn-ghost" onClick={refresh}><RefreshCw size={14}/>重新整理</button></div>

    <div className="card" style={{marginBottom:16}}><div className="card-header"><strong><Plus size={15}/> 新增額外叫貨</strong></div><div className="card-body"><div className="search-input-wrap" style={{width:'100%',maxWidth:760,marginBottom:8}}><Search size={17}/><input value={productSearch} onChange={e=>{setProductSearch(e.target.value);if(product&&e.target.value!==product.name){setProduct(null);setSpec(blankSpec())}}} placeholder="輸入商品名稱後由 SQL 搜尋..." style={{paddingLeft:36,height:46,fontSize:15}}/></div>{productSearch&&!product&&<div style={{border:'1px solid var(--border)',borderRadius:10,maxHeight:220,overflowY:'auto',marginBottom:10,maxWidth:760}}>{productMatches.map(p=><button type="button" key={p.id} onClick={()=>{setProduct(p);setProductSearch(p.name);setProductMatches([]);setSpec(blankSpec())}} style={{display:'flex',justifyContent:'space-between',width:'100%',padding:'11px 12px',border:0,borderBottom:'1px solid var(--border)',background:'#fff',cursor:'pointer'}}><strong>{p.name}</strong><span style={{color:'#2563eb'}}>{p.supplier||'未設定廠商'}</span></button>)}</div>}{product&&<div><div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}><SpecFields product={product} spec={spec} onChange={(k,v)=>setSpec(s=>({...s,[k]:v}))}/><span>額外數量</span><QuantityInput value={qty} min={1} onChange={setQty} style={{width:110,height:44,fontSize:18,fontWeight:900,textAlign:'center'}}/><input value={note} onChange={e=>setNote(e.target.value)} placeholder="備註" style={{minWidth:180,flex:1}}/><button className="btn btn-primary" disabled={saving||Boolean(specError)} onClick={createExtra}>{saving?'建立中...':'建立額外叫貨'}</button></div><div style={{marginTop:9,fontSize:12,color:specError?'#dc2626':'var(--text-secondary)'}}>{specError?`⚠ ${specError}`:`目前規格：${stockSpecLabel(spec)}｜單位成本：NT$${unitCost.toLocaleString()}`}</div></div>}</div></div>

    <div className="card" style={{marginBottom:16}}><div className="card-header"><strong><PackageCheck size={15}/> 待入庫的額外叫貨</strong><span style={{fontSize:12,color:'var(--text-muted)'}}>{extras.length} 筆</span></div><div className="table-container"><table><thead><tr><th>商品</th><th>供應廠商</th><th>規格</th><th>叫貨</th><th>已入庫</th><th>單位成本</th><th>備註</th><th>操作</th></tr></thead><tbody>{extras.length===0&&<tr><td colSpan={8} style={{textAlign:'center',padding:24,color:'var(--text-muted)'}}>目前沒有待入庫的額外叫貨</td></tr>}{extras.map(r=>{const editing=editingExtraId===r.id,received=Math.max(0,Number(r.received_qty||0));return <tr key={r.id}><td><strong>{r.product_name}</strong></td><td style={{color:'#2563eb',fontWeight:900}}>{r.supplier||'未設定'}</td><td>{r.spec_label||stockSpecLabel(r.spec)}</td><td>{editing&&received===0?<input type="number" min="1" value={editExtra?.ordered_qty??r.ordered_qty} onChange={e=>setEditExtra(v=>({...v,ordered_qty:e.target.value}))} style={{width:80,height:36,textAlign:'center'}}/>:r.ordered_qty}</td><td>{received}</td><td>{editing&&received===0?<input type="number" min="0" step="0.01" value={editExtra?.unit_cost??r.unit_cost} onChange={e=>setEditExtra(v=>({...v,unit_cost:e.target.value}))} style={{width:90,height:36,textAlign:'center'}}/>:`NT$${Number(r.unit_cost||0).toLocaleString()}`}</td><td>{editing?<input value={editExtra?.note??''} onChange={e=>setEditExtra(v=>({...v,note:e.target.value}))} placeholder="備註" style={{minWidth:140,height:36}}/>:(r.note||'—')}</td><td><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{editing?<><button className="btn btn-sm btn-primary" disabled={extraBusyId===r.id} onClick={()=>saveExtra(r)}>儲存</button><button className="btn btn-sm btn-ghost" onClick={cancelEditExtra}>取消</button></>:<><button className="btn btn-sm btn-ghost" onClick={()=>beginEditExtra(r)}><Pencil size={13}/>修改</button><button className="btn btn-sm btn-danger" disabled={received>0||extraBusyId===r.id} onClick={()=>deleteExtra(r)}><Trash2 size={13}/>刪除</button><button className="btn btn-sm btn-primary" onClick={()=>receive(r)}><ArchiveRestore size={13}/>全部到貨並轉現貨</button></>}</div></td></tr>})}</tbody></table></div></div>

    <div className="card" style={{marginBottom:16}}><div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}><strong><Warehouse size={15}/> 可售現貨</strong><span style={{fontSize:12,color:'var(--text-muted)'}}>符合 {totalCount} 筆規格，共 {totalQty} 件</span></div><div className="card-body"><div className="search-input-wrap" style={{width:'100%',maxWidth:760,marginBottom:12}}><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋商品／規格／供應商（SQL 全庫搜尋）" style={{paddingLeft:36,height:46,fontSize:15}}/></div><div className="table-container"><table><thead><tr><th>商品</th><th>供應廠商</th><th>規格</th><th>可售現貨</th><th>手動調整</th></tr></thead><tbody>{!loading&&stock.length===0&&<tr><td colSpan={5} style={{textAlign:'center',padding:28,color:'var(--text-muted)'}}>目前沒有符合的現貨</td></tr>}{stock.map(r=><tr key={r.neon_id||r.id}><td><strong>{r.product_name}</strong></td><td style={{color:'#2563eb',fontWeight:900}}>{r.supplier||'未設定'}</td><td>{r.spec_label||stockSpecLabel(r.spec)}</td><td><strong style={{fontSize:18,color:Number(r.available_qty||0)>0?'#059669':'#94a3b8'}}>{r.available_qty||0}</strong></td><td><input type="number" min="0" defaultValue={r.available_qty||0} onBlur={e=>adjust(r,e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} style={{width:100,height:40,textAlign:'center',fontWeight:900}}/></td></tr>)}</tbody></table></div>{hasMore&&<div style={{textAlign:'center',paddingTop:12}}><button className="btn btn-ghost" disabled={loadingMore} onClick={()=>loadStock({append:true})}>{loadingMore?'載入中...':`載入更多（已顯示 ${stock.length}/${totalCount}）`}</button></div>}</div></div>

    <div className="card"><div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}><strong><History size={15}/> 庫存異動流水</strong><span style={{fontSize:12,color:'var(--text-muted)'}}>最近 {movements.length} 筆</span></div><div className="table-container"><table><thead><tr><th>時間</th><th>商品</th><th>類型</th><th>增減</th><th>異動後</th><th>關聯</th><th>備註</th></tr></thead><tbody>{movements.length===0&&<tr><td colSpan={7} style={{textAlign:'center',padding:26,color:'var(--text-muted)'}}>尚無庫存流水</td></tr>}{movements.map(r=><tr key={r.id}><td style={{whiteSpace:'nowrap',fontSize:12}}>{r.created_at?new Date(r.created_at).toLocaleString('zh-TW'):'—'}</td><td><strong>{r.product_name||r.product_id}</strong></td><td><span className="badge badge-gray">{movementLabel(r.transaction_type)}</span></td><td><strong style={{color:Number(r.qty_change)>=0?'#059669':'#dc2626'}}>{Number(r.qty_change)>=0?'+':''}{r.qty_change}</strong></td><td><strong>{r.balance_after}</strong></td><td style={{fontSize:11,color:'var(--text-secondary)'}}>{r.order_id?`訂單 ${r.order_id}`:r.extra_id?`叫貨 ${r.extra_id}`:'—'}</td><td style={{fontSize:12}}>{r.note||'—'}</td></tr>)}</tbody></table></div></div>
  </div>
}
