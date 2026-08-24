import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, X, Save, LogOut, ClipboardList, Users, UserRound, Plus } from 'lucide-react'
import { useAuth } from '../components/AuthGuard'
import { useToast } from '../components/UI'
import { HelperAPI } from '../lib/helper'
import { filterCustomers, customerSecondaryLabel, getCustomerPhoneLast2 } from '../lib/customerSearch'
import QuantityInput from '../components/QuantityInput'

const blankSpec = () => ({ package: '', flavor: '', color: '', size: '' })
const makeLineId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
const blankLine = () => ({ line_id: makeLineId(), qty: 1, spec: blankSpec(), note: '' })

function itemPrice(product, spec = {}) {
  const opt = (product?.price_options || []).find(o => o.label === spec.package)
  return Number(opt?.price ?? product?.price ?? 0)
}

function specError(product, spec = {}) {
  if (!product) return '請先選擇商品'
  if ((product.price_options || []).length && !spec.package) return '請選擇組合／包裝'
  if ((product.spec_flavors || []).length && !spec.flavor) return '請選擇口味'
  if (['color_size', 'color_free', 'color_only'].includes(product.spec_mode) && !spec.color) return '請選擇顏色'
  if (['color_size', 'size_only'].includes(product.spec_mode) && !spec.size) return '請選擇尺寸'
  return ''
}

function hasSelectableSpec(product) {
  if (!product) return false
  return (
    (product.price_options || []).length > 0 ||
    (product.spec_flavors || []).length > 0 ||
    ['color_size', 'color_free', 'color_only', 'size_only'].includes(product.spec_mode)
  )
}

function SpecFields({ product, spec, onChange }) {
  if (!product) return null
  const style = { height: 40, minWidth: 120 }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {(product.price_options || []).length > 0 && (
        <select value={spec.package || ''} onChange={e => onChange('package', e.target.value)} style={style}>
          <option value="">組合／包裝 *</option>
          {product.price_options.map(o => (
            <option key={o.label} value={o.label}>{o.label}｜NT${Number(o.price || 0).toLocaleString()}</option>
          ))}
        </select>
      )}
      {(product.spec_flavors || []).length > 0 && (
        <select value={spec.flavor || ''} onChange={e => onChange('flavor', e.target.value)} style={style}>
          <option value="">口味 *</option>
          {product.spec_flavors.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      )}
      {['color_size', 'color_free', 'color_only'].includes(product.spec_mode) && (
        <select value={spec.color || ''} onChange={e => onChange('color', e.target.value)} style={style}>
          <option value="">顏色 *</option>
          {(product.spec_colors || []).map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      )}
      {['color_size', 'size_only'].includes(product.spec_mode) && (
        <select value={spec.size || ''} onChange={e => onChange('size', e.target.value)} style={style}>
          <option value="">尺寸 *</option>
          {(product.spec_sizes || []).map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      )}
    </div>
  )
}

export default function HelperPortalV3() {
  const { user, account, logout } = useAuth()
  const toast = useToast()

  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState('customer')

  const [customerSearch, setCustomerSearch] = useState('')
  const [customer, setCustomer] = useState(null)
  const [items, setItems] = useState([])
  const [productSearch, setProductSearch] = useState('')
  const [productOpen, setProductOpen] = useState(false)
  const [isVirtual, setIsVirtual] = useState(false)
  const [note, setNote] = useState('')

  const [batchProduct, setBatchProduct] = useState(null)
  const [batchProductSearch, setBatchProductSearch] = useState('')
  const [batchProductOpen, setBatchProductOpen] = useState(false)
  const [batchCustomerSearch, setBatchCustomerSearch] = useState('')
  const [batchCustomerOpen, setBatchCustomerOpen] = useState(false)
  const [batchRows, setBatchRows] = useState([])
  const [batchNote, setBatchNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [c, p, e] = await Promise.all([
        HelperAPI.customers(),
        HelperAPI.catalog(),
        HelperAPI.myEntries(user.uid),
      ])
      setCustomers(c)
      setProducts(p)
      setEntries(e)
    } catch (err) {
      toast('載入失敗：' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [user, toast])

  useEffect(() => { if (user) load() }, [user, load])

  const custs = useMemo(() => filterCustomers(customers, customerSearch).slice(0, 20), [customers, customerSearch])
  const batchCusts = useMemo(() => filterCustomers(customers, batchCustomerSearch).slice(0, 30), [customers, batchCustomerSearch])
  const productMatches = q => products.filter(p => !q.trim() || String(p.name || '').toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30)
  const prods = useMemo(() => productMatches(productSearch), [products, productSearch])
  const batchProds = useMemo(() => productMatches(batchProductSearch), [products, batchProductSearch])

  function renderProductList(list, search, onPick) {
    if (!products.length) return <div style={{ padding: 14, color: '#b45309' }}>⚠ 尚未同步商品目錄</div>
    if (!list.length) return <div style={{ padding: 14, color: 'var(--text-muted)' }}>找不到符合「{search}」的商品</div>
    return list.map(p => <button key={p.id} onClick={() => onPick(p)} style={{ display:'flex', width:'100%', justifyContent:'space-between', padding:'12px 14px', border:0, borderBottom:'1px solid var(--border)', background:'#fff', cursor:'pointer' }}><strong>{p.name}</strong><strong>NT${Number(p.price || 0).toLocaleString()}</strong></button>)
  }

  function addProduct(product) {
    setItems(v => [...v, { product, ...blankLine() }])
    setProductSearch('')
    setProductOpen(false)
  }
  function addSameProductLine(index) {
    setItems(prev => {
      const source = prev[index]
      if (!source) return prev
      return [...prev.slice(0,index+1), { product:source.product, ...blankLine() }, ...prev.slice(index+1)]
    })
  }
  function patchItem(i, patch) { setItems(v => v.map((x,n) => n === i ? { ...x, ...patch } : x)) }
  function patchItemSpec(i, key, value) { setItems(v => v.map((x,n) => n === i ? { ...x, spec:{ ...x.spec, [key]:value } } : x)) }

  async function saveCustomerMode() {
    if (!customer) return toast('請先選擇客戶','error')
    if (!items.length) return toast('請至少加入一項商品','error')
    for (const x of items) {
      if (Number(x.qty) < 1) return toast('數量至少為 1','error')
      const e = specError(x.product,x.spec)
      if (e) return toast(`${x.product.name}：${e}`,'error')
    }
    setSaving(true)
    try {
      const cleanItems = items.map(x => ({ product_id:x.product.id, product_name:x.product.name, sale_price:itemPrice(x.product,x.spec), qty:Number(x.qty), spec:x.spec, note:x.note || '' }))
      await HelperAPI.createDirectEntry({
        created_by_uid:user.uid,
        created_by_name:account?.display_name || user.email || '',
        customer_id:customer.id,
        customer_name:customer.name,
        customer_phone_last2:getCustomerPhoneLast2(customer),
        items:cleanItems,
        total_amount:cleanItems.reduce((s,x)=>s+x.sale_price*x.qty,0),
        is_virtual:isVirtual,
        note:note.trim(),
      })
      toast(`訂單已直接建立${isVirtual ? '（虛擬）' : ''} ✓`)
      setCustomer(null); setItems([]); setCustomerSearch(''); setIsVirtual(false); setNote('')
      await load()
    } catch (err) { toast('建立訂單失敗：'+err.message,'error') }
    finally { setSaving(false) }
  }

  function chooseBatchProduct(product) {
    if (batchRows.length && !window.confirm('更換商品會清除已加入的客戶，確定嗎？')) return
    setBatchProduct(product); setBatchRows([]); setBatchProductSearch(''); setBatchProductOpen(false)
  }
  function addBatchCustomer(c) {
    if (!batchProduct) return toast('請先選擇商品','error')
    const alreadyAdded = batchRows.some(r => r.customer.id === c.id)
    setBatchRows(v => {
      const index = v.findIndex(r => r.customer.id === c.id)
      if (index >= 0) {
        const target = v[index]
        const updated = { ...target, items:[...target.items,blankLine()] }
        return [updated, ...v.filter((_,i)=>i!==index)]
      }
      return [{ customer:c, items:[blankLine()], is_virtual:false }, ...v]
    })
    setBatchCustomerSearch(''); setBatchCustomerOpen(false)
    if (alreadyAdded) toast(`${c.name}：已新增另一個規格／數量欄位，並移到最上方 ✓`)
  }
  function addBatchLine(customerId) { setBatchRows(v => v.map(r => r.customer.id === customerId ? { ...r, items:[...r.items,blankLine()] } : r)) }
  function removeBatchLine(customerId,index) { setBatchRows(v => v.map(r => { if (r.customer.id !== customerId) return r; const next=r.items.filter((_,i)=>i!==index); return { ...r, items:next.length?next:[blankLine()] } })) }
  function patchBatchLine(customerId,index,patch) { setBatchRows(v => v.map(r => r.customer.id !== customerId ? r : { ...r, items:r.items.map((x,i)=>i===index?{...x,...patch}:x) })) }
  function patchBatchSpec(customerId,index,key,value) { setBatchRows(v => v.map(r => r.customer.id !== customerId ? r : { ...r, items:r.items.map((x,i)=>i===index?{...x,spec:{...x.spec,[key]:value}}:x) })) }
  function toggleBatchVirtual(customerId) { setBatchRows(v => v.map(r => r.customer.id === customerId ? { ...r, is_virtual:!r.is_virtual } : r)) }

  async function saveBatch() {
    if (!batchProduct) return toast('請先選擇商品','error')
    if (!batchRows.length) return toast('請至少加入一位客戶','error')
    for (const r of batchRows) {
      for (let i=0;i<r.items.length;i+=1) {
        const line=r.items[i]
        if (Number(line.qty)<1) return toast(`${r.customer.name} 第${i+1}筆：數量至少為 1`,'error')
        const e=specError(batchProduct,line.spec)
        if (e) return toast(`${r.customer.name} 第${i+1}筆：${e}`,'error')
      }
    }
    const payloads = batchRows.map(r => {
      const cleanItems = r.items.map(line => ({ product_id:batchProduct.id, product_name:batchProduct.name, sale_price:itemPrice(batchProduct,line.spec), qty:Number(line.qty), spec:line.spec, note:line.note || '' }))
      return {
        created_by_uid:user.uid,
        created_by_name:account?.display_name || user.email || '',
        customer_id:r.customer.id,
        customer_name:r.customer.name,
        customer_phone_last2:getCustomerPhoneLast2(r.customer),
        items:cleanItems,
        total_amount:cleanItems.reduce((s,x)=>s+x.sale_price*x.qty,0),
        is_virtual:Boolean(r.is_virtual),
        note:batchNote.trim(),
      }
    })
    setSaving(true)
    try {
      const count = await HelperAPI.createDirectEntries(payloads)
      toast(`已直接建立 ${count} 位客戶訂單 ✓`)
      setBatchRows([]); setBatchCustomerSearch(''); setBatchNote('')
      await load()
    } catch (err) { toast('建立訂單失敗：'+err.message,'error') }
    finally { setSaving(false) }
  }

  const total = items.reduce((s,x)=>s+itemPrice(x.product,x.spec)*Number(x.qty||0),0)
  const batchTotal = batchRows.reduce((sum,r)=>sum+r.items.reduce((s,line)=>s+itemPrice(batchProduct,line.spec)*Number(line.qty||0),0),0)

  return <div style={{ minHeight:'100vh', background:'#f8fafc' }}>
    <header style={{ position:'sticky', top:0, zIndex:20, background:'#0f172a', color:'#fff', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}><div><strong style={{fontSize:18}}>📝 小幫手團購登記</strong><div style={{fontSize:11,opacity:.6}}>{account?.display_name||user?.email}</div></div><button onClick={logout} style={{border:'1px solid rgba(255,255,255,.2)',background:'transparent',color:'#fff',borderRadius:8,padding:'8px 10px'}}><LogOut size={14}/> 登出</button></header>
    <main style={{ maxWidth:980, margin:'0 auto', padding:16 }}>
      <div style={{ background:'#ecfdf5', border:'1px solid #a7f3d0', padding:'10px 12px', borderRadius:10, marginBottom:14, fontSize:13, color:'#065f46' }}>送出後會直接建立訂單；後台小幫手登記僅保留查詢與薪資統計紀錄。</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:10,marginBottom:14}}><button onClick={()=>setMode('customer')} style={{padding:14,borderRadius:12,border:`2px solid ${mode==='customer'?'var(--indigo)':'var(--border)'}`,background:mode==='customer'?'var(--indigo-light)':'#fff',fontWeight:900}}><UserRound size={16}/> 依客戶打單<div style={{fontSize:11,fontWeight:500}}>一位客戶可加入多項商品、多個規格</div></button><button onClick={()=>setMode('product')} style={{padding:14,borderRadius:12,border:`2px solid ${mode==='product'?'var(--emerald)':'var(--border)'}`,background:mode==='product'?'var(--emerald-light)':'#fff',fontWeight:900}}><Users size={16}/> 依商品連續打單<div style={{fontSize:11,fontWeight:500}}>同商品、多客戶、多規格</div></button></div>

      {mode==='customer'?<>
        <div className="card" style={{marginBottom:14}}><div className="card-header"><strong>① 選擇客戶</strong></div><div className="card-body"><div className="search-input-wrap"><Search size={16}/><input value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} placeholder="姓名／手機末兩碼／Line／FB" style={{paddingLeft:36,height:48,fontSize:16}}/></div>{customerSearch&&<div style={{marginTop:8,border:'1px solid var(--border)',borderRadius:10,overflow:'hidden'}}>{custs.map(c=><button key={c.id} onClick={()=>{setCustomer(c);setCustomerSearch('')}} style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',border:0,borderBottom:'1px solid var(--border)',background:'#fff'}}><strong>{c.name}</strong><div style={{fontSize:11,color:'var(--text-muted)'}}>{customerSecondaryLabel(c)||'無其他辨識資料'}</div></button>)}</div>}{customer&&<div style={{marginTop:10,padding:12,borderRadius:10,background:'var(--indigo-light)',display:'flex',justifyContent:'space-between'}}><strong>{customer.name}（末碼 {getCustomerPhoneLast2(customer)||'—'}）</strong><button onClick={()=>setCustomer(null)} style={{border:0,background:'transparent'}}><X size={16}/></button></div>}</div></div>
        <div className="card" style={{marginBottom:14}}><div className="card-header"><strong>② 加入商品與規格</strong></div><div className="card-body"><div className="search-input-wrap"><Search size={16}/><input value={productSearch} onFocus={()=>setProductOpen(true)} onChange={e=>{setProductSearch(e.target.value);setProductOpen(true)}} placeholder="點選或輸入商品名稱" style={{paddingLeft:36,height:48,fontSize:16}}/></div>{productOpen&&<div style={{marginTop:8,border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'#fff',maxHeight:320,overflowY:'auto'}}>{renderProductList(prods,productSearch,addProduct)}</div>}{items.map((x,i)=><div key={x.line_id||i} style={{marginTop:10,padding:12,border:'1px solid var(--border)',borderRadius:10,background:'#fff'}}><div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}><strong style={{flex:1}}>{x.product.name}</strong><span style={{fontSize:14,color:'var(--text-muted)',fontWeight:800}}>數量</span><QuantityInput value={x.qty} min={1} onChange={v=>patchItem(i,{qty:v})} style={{width:130,height:48,fontSize:20,padding:'8px 12px',textAlign:'center',fontWeight:800}}/><button onClick={()=>setItems(v=>v.filter((_,n)=>n!==i))} style={{border:0,background:'transparent',color:'var(--rose)'}}><X size={16}/></button></div><div style={{marginTop:8}}><SpecFields product={x.product} spec={x.spec} onChange={(k,v)=>patchItemSpec(i,k,v)}/></div><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:8}}><input value={x.note} onChange={e=>patchItem(i,{note:e.target.value})} placeholder="商品備註" style={{flex:1,minWidth:150,maxWidth:260}}/>{hasSelectableSpec(x.product)&&<button type="button" className="btn btn-sm btn-ghost" onClick={()=>addSameProductLine(i)} style={{color:'var(--indigo)',fontWeight:900,border:'1px solid var(--indigo)'}}><Plus size={14}/> 再加一個規格／數量</button>}</div><div style={{fontSize:12,color:'var(--text-secondary)',marginTop:7}}>單價 NT${itemPrice(x.product,x.spec).toLocaleString()}　小計 NT${(itemPrice(x.product,x.spec)*Number(x.qty||0)).toLocaleString()}</div></div>)}</div></div>
        <div className="card" style={{marginBottom:14}}><div className="card-body"><label style={{display:'flex',gap:10,padding:12,border:'2px solid #fb7185',borderRadius:10,background:isVirtual?'#fff1f2':'#fff'}}><input type="checkbox" checked={isVirtual} onChange={e=>setIsVirtual(e.target.checked)}/><strong style={{color:'#be123c'}}>⚠ 設為虛擬訂單</strong></label><input value={note} onChange={e=>setNote(e.target.value)} placeholder="訂單備註" style={{marginTop:10}}/><div style={{textAlign:'right',fontSize:20,fontWeight:900,margin:'10px 0'}}>合計 NT${total.toLocaleString()}</div><button className="btn btn-primary" onClick={saveCustomerMode} disabled={saving} style={{width:'100%',justifyContent:'center',height:50}}><Save size={16}/>{saving?'建立中...':'直接建立訂單'}</button></div></div>
      </>:<>
        <div className="card" style={{marginBottom:14}}><div className="card-header"><strong>① 先選商品</strong></div><div className="card-body"><div className="search-input-wrap"><Search size={16}/><input value={batchProductSearch} onFocus={()=>setBatchProductOpen(true)} onChange={e=>{setBatchProductSearch(e.target.value);setBatchProductOpen(true)}} placeholder="點選或輸入商品名稱" style={{paddingLeft:36,height:48,fontSize:16}}/></div>{batchProductOpen&&<div style={{marginTop:8,border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'#fff',maxHeight:320,overflowY:'auto'}}>{renderProductList(batchProds,batchProductSearch,chooseBatchProduct)}</div>}{batchProduct&&<div style={{marginTop:12,padding:14,border:'2px solid var(--emerald)',background:'var(--emerald-light)',borderRadius:12,display:'flex',justifyContent:'space-between',gap:10}}><div><strong>📦 {batchProduct.name}</strong><div style={{fontSize:12,color:'var(--text-secondary)',marginTop:4}}>每位客戶可加入多個規格，並可個別設定正式／虛擬訂單</div></div><button onClick={()=>{setBatchProduct(null);setBatchRows([])}} style={{border:0,background:'transparent',color:'var(--rose)'}}><X size={18}/></button></div>}</div></div>
        <div className="card" style={{marginBottom:14}}><div className="card-header"><strong>② 連續加入客戶與數量 <span style={{fontSize:12,color:'var(--text-muted)'}}>已加入 {batchRows.length} 位</span></strong></div><div className="card-body"><div className="search-input-wrap"><Search size={16}/><input value={batchCustomerSearch} onFocus={()=>setBatchCustomerOpen(true)} onChange={e=>{setBatchCustomerSearch(e.target.value);setBatchCustomerOpen(true)}} placeholder="姓名／手機末兩碼／Line／FB" style={{paddingLeft:36,height:48,fontSize:16}}/></div>{batchCustomerOpen&&batchCustomerSearch&&<div style={{marginTop:8,border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'#fff',maxHeight:300,overflowY:'auto'}}>{batchCusts.map(c=><button key={c.id} onClick={()=>addBatchCustomer(c)} style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',border:0,borderBottom:'1px solid var(--border)',background:'#fff'}}><strong>{c.name}</strong><div style={{fontSize:11,color:'var(--text-muted)'}}>{customerSecondaryLabel(c)}</div></button>)}</div>}
        {batchRows.map((r,i)=><div key={r.customer.id} style={{marginTop:12,padding:12,border:`1px solid ${r.is_virtual?'#fb7185':'var(--border)'}`,borderRadius:12,background:r.is_virtual?'#fff1f2':'#fff'}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:8,flexWrap:'wrap'}}><div><strong>{i+1}. {r.customer.name}</strong><div style={{fontSize:11,color:'var(--text-muted)'}}>{customerSecondaryLabel(r.customer)}</div></div><div style={{display:'flex',gap:10,alignItems:'center'}}><label style={{display:'flex',gap:6,alignItems:'center',fontWeight:800,color:r.is_virtual?'#be123c':'var(--text-secondary)',cursor:'pointer'}}><input type="checkbox" checked={Boolean(r.is_virtual)} onChange={()=>toggleBatchVirtual(r.customer.id)}/> 虛擬訂單</label><button onClick={()=>setBatchRows(v=>v.filter(x=>x.customer.id!==r.customer.id))} style={{border:0,background:'transparent',color:'var(--rose)'}}><X size={17}/></button></div></div>{r.items.map((line,lineIndex)=><div key={line.line_id||lineIndex} style={{padding:'10px 0',borderTop:'1px dashed var(--border)'}}><div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}><SpecFields product={batchProduct} spec={line.spec} onChange={(k,v)=>patchBatchSpec(r.customer.id,lineIndex,k,v)}/><span style={{fontSize:14,color:'var(--text-muted)',fontWeight:800}}>數量</span><QuantityInput value={line.qty} min={1} onChange={v=>patchBatchLine(r.customer.id,lineIndex,{qty:v})} style={{width:130,height:48,fontSize:20,padding:'8px 12px',textAlign:'center',fontWeight:800}}/><input value={line.note} onChange={e=>patchBatchLine(r.customer.id,lineIndex,{note:e.target.value})} placeholder="備註" style={{flex:1,minWidth:130}}/>{r.items.length>1&&<button onClick={()=>removeBatchLine(r.customer.id,lineIndex)} className="btn btn-sm btn-ghost" style={{color:'var(--rose)'}}><X size={13}/>移除</button>}</div><div style={{fontSize:12,color:'var(--text-secondary)',marginTop:6}}>單價 NT${itemPrice(batchProduct,line.spec).toLocaleString()}　小計 NT${(itemPrice(batchProduct,line.spec)*Number(line.qty||0)).toLocaleString()}</div></div>)}<button type="button" className="btn btn-sm btn-ghost" onClick={()=>addBatchLine(r.customer.id)} style={{marginTop:8,color:'var(--indigo)',fontWeight:900,border:'1px solid var(--indigo)'}}><Plus size={14}/> 再加一個規格／數量</button></div>)}</div></div>
        <div className="card" style={{marginBottom:14}}><div className="card-body"><input value={batchNote} onChange={e=>setBatchNote(e.target.value)} placeholder="本批共用備註"/><div style={{display:'flex',justifyContent:'space-between',margin:'12px 0',fontWeight:900}}><span>共 {batchRows.length} 位客戶</span><span>合計 NT${batchTotal.toLocaleString()}</span></div><button className="btn btn-primary" onClick={saveBatch} disabled={saving||!batchRows.length} style={{width:'100%',justifyContent:'center',height:52,fontSize:16}}><Save size={16}/>{saving?'建立中...':`直接建立 ${batchRows.length} 位客戶訂單`}</button></div></div>
      </>}

      <div className="card"><div className="card-header"><strong><ClipboardList size={15}/> 我的最近登記</strong></div><div className="table-container"><table><thead><tr><th>客戶</th><th>商品</th><th>類型</th><th>狀態</th></tr></thead><tbody>{entries.slice(0,20).map(e=><tr key={e.id} style={{background:e.is_virtual?'#fff1f2':undefined}}><td>{e.customer_name}<div style={{fontSize:10,color:'var(--text-muted)'}}>末碼 {e.customer_phone_last2||'—'}</div></td><td>{(e.items||[]).map((x,i)=><div key={i}>{x.product_name} ×{x.qty}{x.spec?.package?`／${x.spec.package}`:''}{x.spec?.flavor?`／${x.spec.flavor}`:''}{x.spec?.color?`／${x.spec.color}`:''}{x.spec?.size?`／${x.spec.size}`:''}</div>)}</td><td><span className={`badge ${e.is_virtual?'badge-rose':'badge-emerald'}`}>{e.is_virtual?'虛擬':'正式'}</span></td><td><span className={`badge ${e.status==='converted'?'badge-emerald':e.status==='cancelled'?'badge-gray':'badge-amber'}`}>{e.status==='converted'?'已建立訂單':e.status==='cancelled'?'已取消':'舊待確認'}</span></td></tr>)}{!loading&&!entries.length&&<tr><td colSpan={4} style={{textAlign:'center',padding:24,color:'var(--text-muted)'}}>尚無登記</td></tr>}</tbody></table></div></div>
    </main>
  </div>
}
