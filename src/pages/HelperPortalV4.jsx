import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, LogOut, Pencil, RefreshCw, Save, ShoppingCart, Warehouse, X } from 'lucide-react'
import { useAuth } from '../components/AuthGuard'
import { useToast } from '../components/UI'
import HelperPortalV3 from './HelperPortalV3'
import { HelperAPI } from '../lib/helper'
import QuantityInput from '../components/QuantityInput'
import HelperStockPanel from '../components/HelperStockPanel'

const money = v => `NT$${Number(v || 0).toLocaleString()}`
const dateText = v => v ? new Date(v).toLocaleDateString('zh-TW') : '—'

function productByItem(products,item){
  return products.find(p => p.id === (item.product_id || item.id)) || null
}
function hasArrived(order){ return (order.items || []).some(item => Number(item.arrived_qty || 0) > 0) }

function SpecEditor({ product,spec,onChange,disabled }){
  if(!product) return <span style={{fontSize:12,color:'#b45309'}}>商品目錄中找不到此商品</span>
  const style={height:40,minWidth:110}
  return <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
    {(product.price_options||[]).length>0&&<select disabled={disabled} value={spec.package||''} onChange={e=>onChange('package',e.target.value)} style={style}><option value="">組合／包裝 *</option>{product.price_options.map(o=><option key={o.label} value={o.label}>{o.label}</option>)}</select>}
    {(product.spec_flavors||[]).length>0&&<select disabled={disabled} value={spec.flavor||''} onChange={e=>onChange('flavor',e.target.value)} style={style}><option value="">口味 *</option>{product.spec_flavors.map(v=><option key={v}>{v}</option>)}</select>}
    {['color_size','color_free','color_only'].includes(product.spec_mode)&&<select disabled={disabled} value={spec.color||''} onChange={e=>onChange('color',e.target.value)} style={style}><option value="">顏色 *</option>{(product.spec_colors||[]).map(v=><option key={v}>{v}</option>)}</select>}
    {['color_size','size_only'].includes(product.spec_mode)&&<select disabled={disabled} value={spec.size||''} onChange={e=>onChange('size',e.target.value)} style={style}><option value="">尺寸 *</option>{(product.spec_sizes||[]).map(v=><option key={v}>{v}</option>)}</select>}
  </div>
}

function MyPendingOrders(){
  const { user }=useAuth()
  const toast=useToast()
  const [orders,setOrders]=useState([])
  const [products,setProducts]=useState([])
  const [loading,setLoading]=useState(true)
  const [catalogLoading,setCatalogLoading]=useState('')
  const [editing,setEditing]=useState('')
  const [drafts,setDrafts]=useState({})
  const [saving,setSaving]=useState('')
  const [search,setSearch]=useState('')

  const load=useCallback(async()=>{
    if(!user) return
    setLoading(true)
    try{
      setOrders(await HelperAPI.myPendingOrders(user.uid))
    }catch(err){toast('未出貨訂單載入失敗：'+err.message,'error')}
    finally{setLoading(false)}
  },[user,toast])
  useEffect(()=>{load()},[load])

  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase()
    if(!q)return orders
    return orders.filter(o=>[o.customer_name,o.customer_phone_last2,...(o.items||[]).map(i=>i.product_name||i.name)].some(v=>String(v||'').toLowerCase().includes(q)))
  },[orders,search])

  async function begin(order){
    if(!products.length){
      setCatalogLoading(order.id)
      try{setProducts(await HelperAPI.catalog())}
      catch(err){toast('商品目錄載入失敗：'+err.message,'error');return}
      finally{setCatalogLoading('')}
    }
    setEditing(order.id)
    setDrafts(p=>({...p,[order.id]:{
      items:(order.items||[]).map(i=>({product_id:i.product_id||i.id,product_name:i.product_name||i.name,qty:Number(i.qty||1),spec:{...(i.spec||{})},note:i.note||''})),
      note:order.note||'',is_virtual:Boolean(order.is_virtual)
    }}))
  }
  function cancel(){setEditing('')}
  function patchItem(orderId,index,patch){setDrafts(p=>({...p,[orderId]:{...p[orderId],items:p[orderId].items.map((x,i)=>i===index?{...x,...patch}:x)}}))}
  function patchSpec(orderId,index,key,value){setDrafts(p=>({...p,[orderId]:{...p[orderId],items:p[orderId].items.map((x,i)=>i===index?{...x,spec:{...x.spec,[key]:value}}:x)}}))}
  async function save(order){
    const draft=drafts[order.id]
    if(!draft)return
    for(const [index,item] of draft.items.entries()){
      if(!Number.isInteger(Number(item.qty))||Number(item.qty)<1)return toast(`第 ${index+1} 項數量至少為 1`,'error')
      const product=productByItem(products,item)
      if(!product)return toast(`商品「${item.product_name}」目前無法修改，請聯絡管理者`,'error')
      if((product.price_options||[]).length&&!item.spec?.package)return toast(`「${item.product_name}」請選擇組合／包裝`,'error')
      if((product.spec_flavors||[]).length&&!item.spec?.flavor)return toast(`「${item.product_name}」請選擇口味`,'error')
      if(['color_size','color_free','color_only'].includes(product.spec_mode)&&!item.spec?.color)return toast(`「${item.product_name}」請選擇顏色`,'error')
      if(['color_size','size_only'].includes(product.spec_mode)&&!item.spec?.size)return toast(`「${item.product_name}」請選擇尺寸`,'error')
    }
    setSaving(order.id)
    try{await HelperAPI.updateMyPendingOrder(user.uid,order.id,draft);toast('訂單已更新，後台同步完成 ✓');setEditing('');await load()}
    catch(err){toast('修改失敗：'+err.message,'error')}
    finally{setSaving('')}
  }

  const qty=filtered.reduce((s,o)=>s+(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0),0)
  return <div>
    <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:12}}><div><strong style={{fontSize:18}}>我的未出貨訂單</strong><div style={{fontSize:12,color:'var(--text-muted)',marginTop:3}}>SQL 只讀你自己尚未出貨的訂單；商品目錄只有按「修改」時才載入。</div></div><button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}><RefreshCw size={13}/>重新整理</button></div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:10,marginBottom:12}}><div className="card" style={{padding:12}}><small>未出貨訂單</small><div style={{fontSize:24,fontWeight:900}}>{filtered.length} 筆</div></div><div className="card" style={{padding:12}}><small>商品總數量</small><div style={{fontSize:24,fontWeight:900}}>{qty} 件</div></div></div>
    <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋客戶／末兩碼／商品" style={{height:46,marginBottom:12}}/>
    {loading&&<div className="card" style={{padding:28,textAlign:'center'}}>讀取中...</div>}
    {!loading&&!filtered.length&&<div className="card" style={{padding:30,textAlign:'center',color:'var(--text-muted)'}}>目前沒有自己建立的未出貨訂單</div>}
    {!loading&&filtered.map(order=>{
      const locked=hasArrived(order)
      const isEditing=editing===order.id
      const draft=drafts[order.id]
      return <div className="card" key={order.id} style={{marginBottom:12,border:order.is_virtual?'1.5px solid #fb7185':undefined,background:order.is_virtual?'#fff7f8':undefined}}>
        <div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap'}}><div><strong>{order.customer_name}</strong> <span style={{fontSize:11,color:'var(--text-muted)'}}>末碼 {order.customer_phone_last2||'—'}</span><div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>訂購：{dateText(order.order_date||order.created_at)}</div></div><div style={{display:'flex',gap:7,alignItems:'center'}}><span className={`badge ${order.is_virtual?'badge-rose':'badge-emerald'}`}>{order.is_virtual?'虛擬':'正式'}</span>{(order.items||[]).some(i=>i.fulfillment_type==='stock')&&<span className="badge badge-violet">現貨</span>}{locked?<span className="badge badge-amber">已到貨，已鎖定</span>:!isEditing?<button className="btn btn-sm btn-ghost" disabled={Boolean(catalogLoading)} onClick={()=>begin(order)}><Pencil size={12}/>{catalogLoading===order.id?'讀取商品...':'修改'}</button>:null}</div></div>
        <div className="card-body">
          {!isEditing?(order.items||[]).map((item,i)=><div key={i} style={{padding:'8px 0',borderBottom:i<(order.items||[]).length-1?'1px dashed var(--border)':'none'}}><strong>{item.product_name||item.name}</strong> × <strong>{item.qty}</strong><div style={{fontSize:12,color:'var(--indigo)',fontWeight:800,marginTop:3}}>{[item.spec?.package,item.spec?.flavor,item.spec?.color,item.spec?.size].filter(Boolean).join('／')||'無規格'}</div>{item.note&&<div style={{fontSize:11,color:'var(--rose)',fontWeight:800}}>備註：{item.note}</div>}</div>):draft&&<>
            {draft.items.map((item,i)=>{const product=productByItem(products,item);return <div key={i} style={{padding:'10px 0',borderBottom:'1px dashed var(--border)'}}><strong>{item.product_name}</strong><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:8}}><SpecEditor product={product} spec={item.spec||{}} onChange={(k,v)=>patchSpec(order.id,i,k,v)} disabled={saving===order.id}/><span style={{fontSize:12,color:'var(--text-muted)'}}>數量</span><QuantityInput value={item.qty} min={1} onChange={v=>patchItem(order.id,i,{qty:v})} style={{width:120,height:46,fontSize:19,fontWeight:900,textAlign:'center'}}/><input value={item.note||''} onChange={e=>patchItem(order.id,i,{note:e.target.value})} placeholder="商品備註" style={{flex:1,minWidth:150}}/></div></div>})}
            <label style={{display:'flex',gap:8,alignItems:'center',marginTop:12,fontWeight:800,color:draft.is_virtual?'#be123c':'var(--text-secondary)'}}><input type="checkbox" checked={Boolean(draft.is_virtual)} onChange={e=>setDrafts(p=>({...p,[order.id]:{...p[order.id],is_virtual:e.target.checked}}))}/>虛擬訂單</label>
            <input value={draft.note||''} onChange={e=>setDrafts(p=>({...p,[order.id]:{...p[order.id],note:e.target.value}}))} placeholder="訂單備註" style={{marginTop:10}}/>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:12}}><button className="btn btn-ghost" onClick={cancel}><X size={13}/>取消</button><button className="btn btn-primary" disabled={saving===order.id} onClick={()=>save(order)}><Save size={13}/>{saving===order.id?'儲存中...':'儲存修改'}</button></div>
          </>}
          {!isEditing&&<div style={{display:'flex',justifyContent:'space-between',marginTop:10,fontWeight:900}}><span>{(order.items||[]).reduce((s,i)=>s+Number(i.qty||0),0)} 件</span><span>{money(order.total_amount)}</span></div>}
        </div>
      </div>
    })}
  </div>
}

export default function HelperPortalV4(){
  const { user,account,logout }=useAuth()
  const [tab,setTab]=useState('new')
  return <div style={{minHeight:'100vh',background:'#f8fafc'}}>
    <style>{`.helper-v4-new > div > header{display:none!important}.helper-v4-new > div{min-height:auto!important}.helper-v4-new > div > main{padding-top:0!important}`}</style>
    <header style={{position:'sticky',top:0,zIndex:40,background:'#0f172a',color:'#fff',padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><strong style={{fontSize:18}}>📝 小幫手團購系統</strong><div style={{fontSize:11,opacity:.65}}>{account?.display_name||user?.email}</div></div><button onClick={logout} style={{border:'1px solid rgba(255,255,255,.2)',background:'transparent',color:'#fff',borderRadius:8,padding:'8px 10px'}}><LogOut size={14}/> 登出</button></header>
    <div style={{position:'sticky',top:61,zIndex:35,background:'#f8fafc',padding:'10px 16px 8px',borderBottom:'1px solid #e5e7eb'}}><div style={{maxWidth:980,margin:'0 auto',display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}><button onClick={()=>setTab('new')} style={{height:50,borderRadius:12,border:`2px solid ${tab==='new'?'var(--indigo)':'var(--border)'}`,background:tab==='new'?'var(--indigo-light)':'#fff',fontWeight:900,color:tab==='new'?'var(--indigo)':'var(--text-primary)'}}><ShoppingCart size={15}/> 新增訂單</button><button onClick={()=>setTab('pending')} style={{height:50,borderRadius:12,border:`2px solid ${tab==='pending'?'#059669':'var(--border)'}`,background:tab==='pending'?'#ecfdf5':'#fff',fontWeight:900,color:tab==='pending'?'#047857':'var(--text-primary)'}}><ClipboardList size={15}/> 我的未出貨</button><button onClick={()=>setTab('stock')} style={{height:50,borderRadius:12,border:`2px solid ${tab==='stock'?'#0284c7':'var(--border)'}`,background:tab==='stock'?'#eff6ff':'#fff',fontWeight:900,color:tab==='stock'?'#0369a1':'var(--text-primary)'}}><Warehouse size={15}/> 現貨查詢</button></div></div>
    {tab==='new'?<div className="helper-v4-new"><HelperPortalV3/></div>:<main style={{maxWidth:980,margin:'0 auto',padding:16}}>{tab==='pending'?<MyPendingOrders/>:<HelperStockPanel/>}</main>}
  </div>
}