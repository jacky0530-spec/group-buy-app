import { useState, useEffect, useCallback, useRef } from 'react'
import { OrdersAPI, ProductsAPI, CustomersAPI, snapshotOrderItem, effectiveOrderAmount } from '../lib/db'
import { useToast, Modal, ConfirmDialog } from '../components/UI'
import QuantityInput from '../components/QuantityInput'
import OrderDeleteButton from '../components/OrderDeleteButton'
import GroupedReceipt from '../components/GroupedReceipt'
import { customerSecondaryLabel, filterCustomers, getCustomerPhoneLast2 } from '../lib/customerSearch'
import { Plus, Pencil, Archive, Search, ChevronDown, X, Printer, CheckCircle, Clock, AlertCircle, RotateCcw, DollarSign, Undo2, WalletCards, PackageCheck } from 'lucide-react'

const STATUS_CFG = {
  pending:{ label:'待出貨',badge:'badge-amber',icon:Clock }, shipped:{ label:'已出貨',badge:'badge-emerald',icon:CheckCircle }, cancelled:{ label:'已取消',badge:'badge-rose',icon:AlertCircle },
}
const PAY_CFG = {
  unpaid:{ label:'未收款',badge:'badge-rose' }, paid:{ label:'已收款',badge:'badge-emerald' }, partial_refund:{ label:'部分退款',badge:'badge-amber' }, refunded:{ label:'已全額退款',badge:'badge-gray' },
}
const PAYABLE_CFG = { unpaid:{ label:'供應商未付款',badge:'badge-amber' }, paid:{ label:'供應商已付款',badge:'badge-emerald' } }
const PAYMENT_TERM_LABEL = { order:'訂貨即付款', arrival:'到貨後付款', manual:'手動付款' }

function specLabel(item) {
  const s = item?.spec || {}; const parts = []
  if (s.package) parts.push(`組合：${s.package}`)
  if (s.flavor) parts.push(`口味：${s.flavor}`)
  if (s.color) parts.push(s.color)
  if (s.size) parts.push(s.size)
  return parts.length ? `（${parts.join('／')}）` : ''
}
function validateSpec(product,spec={},priceOptionLabel='') {
  if ((product?.price_options || []).length > 0 && !priceOptionLabel) return `「${product.name}」請選擇組合／包裝價`
  const mode = product?.spec_mode || 'none'
  if (['color_size','color_only','color_free'].includes(mode) && !spec.color) return `「${product.name}」請選擇顏色`
  if (['color_size','size_only'].includes(mode) && !spec.size) return `「${product.name}」請選擇尺碼`
  if ((product?.spec_flavors || []).length > 0 && !spec.flavor) return `「${product.name}」請選擇口味`
  return ''
}
function itemQty(item) { return Math.max(0, Number(item?.qty || 0)) }
function arrivedQty(item) { return Math.min(itemQty(item), Math.max(0, Number(item?.arrived_qty || 0))) }
function arrivalLabel(item) {
  const qty = itemQty(item); const arrived = arrivedQty(item)
  if (!arrived) return { label:'未到貨', cls:'badge-rose' }
  if (arrived >= qty) return { label:`已到貨 ${arrived}/${qty}`, cls:'badge-emerald' }
  return { label:`部分到貨 ${arrived}/${qty}`, cls:'badge-amber' }
}
function SpecSelector({ product,value,onChange }) {
  if (!product) return null
  const mode = product.spec_mode || 'none'; const colors = product.spec_colors || []; const sizes = product.spec_sizes || []; const flavors = product.spec_flavors || []
  const showColor = ['color_size','color_free','color_only'].includes(mode); const showSize = ['color_size','size_only'].includes(mode)
  if (mode === 'none' && flavors.length === 0) return null
  return <div style={{ display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginTop:5 }}>
    {flavors.length > 0 && <select value={value?.flavor || ''} onChange={e => onChange({ ...value,flavor:e.target.value })}><option value="">🍽️ 選口味 *</option>{flavors.map(v => <option key={v} value={v}>{v}</option>)}</select>}
    {showColor && colors.length > 0 && <select value={value?.color || ''} onChange={e => onChange({ ...value,color:e.target.value })}><option value="">選顏色 *</option>{colors.map(v => <option key={v} value={v}>{v}</option>)}</select>}
    {showSize && sizes.length > 0 && <select value={value?.size || ''} onChange={e => onChange({ ...value,size:e.target.value })}><option value="">選尺碼 *</option>{sizes.map(v => <option key={v} value={v}>{v}</option>)}</select>}
    {mode === 'random' && <span className="badge badge-sky">🎲 隨機出貨</span>}{mode === 'color_free' && <span className="badge badge-emerald">Free Size</span>}
  </div>
}
function snapshotForCartItem(item) {
  const base = item.snapshot ? {
    id:item.product.id,
    name:item.snapshot.product_name || item.snapshot.name || item.product.name,
    price:item.snapshot.sale_price ?? item.snapshot.price ?? item.product.price,
    cost:item.snapshot.cost_price ?? item.product.cost ?? 0,
    category:item.snapshot.category ?? item.product.category ?? 'other',
    supplier:item.snapshot.supplier ?? item.product.supplier ?? '',
    supplier_payment_term:item.snapshot.supplier_payment_term ?? item.product.supplier_payment_term ?? 'manual',
  } : item.product
  const priceOption = item.snapshot ? (item.snapshot.spec?.package ? { label:item.snapshot.spec.package, price:item.snapshot.sale_price ?? item.snapshot.price, cost:item.snapshot.cost_price } : null) : ((item.product.price_options || []).find(option => option.label === item.price_option) || null)
  const snap = snapshotOrderItem(base,{ qty:item.qty,note:item.note,spec:item.spec,priceOption })
  snap.arrived_qty = Math.min(Number(snap.qty || 0), Math.max(0, Number(item.snapshot?.arrived_qty || 0)))
  if (item.snapshot?.arrived_at) snap.arrived_at = item.snapshot.arrived_at
  return snap
}

export default function Orders() {
  const toast = useToast()
  const [orders,setOrders] = useState([]); const [products,setProducts] = useState([]); const [customers,setCustomers] = useState([]); const [loading,setLoading] = useState(true)
  const [search,setSearch] = useState(''); const [filterStatus,setFilterStatus] = useState('all'); const [filterPayment,setFilterPayment] = useState('all'); const [showArchived,setShowArchived] = useState(false); const [selected,setSelected] = useState([])
  const [showForm,setShowForm] = useState(false); const [editId,setEditId] = useState(null); const [formCustomer,setFormCustomer] = useState(null); const [custSearch,setCustSearch] = useState(''); const [custOpen,setCustOpen] = useState(false)
  const [cartItems,setCartItems] = useState([]); const [prodSearch,setProdSearch] = useState(''); const [prodOpen,setProdOpen] = useState(false); const [orderNote,setOrderNote] = useState(''); const [saving,setSaving] = useState(false)
  const [receiptOrders,setReceiptOrders] = useState(null); const [confirmArchive,setConfirmArchive] = useState(null); const [cancelOrder,setCancelOrder] = useState(null); const [cancelReason,setCancelReason] = useState(''); const [refundOrder,setRefundOrder] = useState(null); const [refundAmount,setRefundAmount] = useState(''); const [refundNote,setRefundNote] = useState('')
  const custRef = useRef(null); const prodRef = useRef(null)

  useEffect(() => { const handler=e => { if (custRef.current && !custRef.current.contains(e.target)) setCustOpen(false); if (prodRef.current && !prodRef.current.contains(e.target)) setProdOpen(false) }; document.addEventListener('mousedown',handler); return () => document.removeEventListener('mousedown',handler) },[])
  const load = useCallback(async () => { setLoading(true); try { const [ords,prods,custs] = await Promise.all([OrdersAPI.list(),ProductsAPI.list(),CustomersAPI.list()]); setOrders(ords); setProducts(prods); setCustomers(custs) } catch (err) { toast('載入失敗：'+err.message,'error') } finally { setLoading(false) } },[toast])
  useEffect(() => { load() },[load])

  const prodMap = Object.fromEntries(products.map(p => [p.id,p])); const customerMap = Object.fromEntries(customers.map(c => [c.id,c])); const visibleOrders = orders.filter(o => showArchived ? true : !o.archived)
  const orderPhoneLast2 = o => String(o.customer_phone_last2 || getCustomerPhoneLast2(customerMap[o.customer_id]) || '').trim()
  const filtered = visibleOrders.filter(o => { const q = search.toLowerCase().trim(); const ms = (o.customer_name || '').toLowerCase().includes(q) || orderPhoneLast2(o).toLowerCase().includes(q) || String(o.customer_phone || customerMap[o.customer_id]?.phone || '').includes(search.trim()) || (o.items || []).some(i => (i.product_name || i.name || '').toLowerCase().includes(q)); return ms && (filterStatus === 'all' || o.status === filterStatus) && (filterPayment === 'all' || o.payment_status === filterPayment) })
  const filtCusts = filterCustomers(customers,custSearch)
  const filtProds = products.filter(p => p.name.toLowerCase().includes(prodSearch.toLowerCase()))

  function openAdd() { setEditId(null); setFormCustomer(null); setCartItems([]); setOrderNote(''); setCustSearch(''); setProdSearch(''); setShowForm(true) }
  function productFromSnapshot(item) { const id = item.product_id || item.id; return prodMap[id] || { id,name:item.product_name || item.name,price:item.sale_price ?? item.price ?? 0,cost:item.cost_price ?? 0,category:item.category || 'other',supplier:item.supplier || '',supplier_payment_term:item.supplier_payment_term||'manual',spec_mode:'none',spec_flavors:item.spec?.flavor ? [item.spec.flavor] : [],spec_colors:item.spec?.color ? [item.spec.color] : [],spec_sizes:item.spec?.size ? [item.spec.size] : [],price_options:item.spec?.package ? [{label:item.spec.package,price:item.sale_price ?? item.price ?? 0,cost:item.cost_price ?? ''}] : [] } }
  function openEdit(o) { const customer = customers.find(c => c.id === o.customer_id) || { id:o.customer_id,name:o.customer_name,phone:o.customer_phone || '',phone_last2:o.customer_phone_last2 || '' }; setEditId(o.id); setFormCustomer(customer); setCartItems((o.items || []).map(item => ({ product:productFromSnapshot(item),qty:item.qty,note:item.note || '',spec:item.spec || {},price_option:item.spec?.package || '',snapshot:item }))); setOrderNote(o.note || ''); setShowForm(true) }
  function addToCart(product) { setCartItems(prev => [...prev,{ product,qty:1,note:'',spec:{ color:'',size:'',flavor:'' },price_option:'',snapshot:null }]); setProdOpen(false); setProdSearch('') }
  function addSameProduct(idx) { setCartItems(prev => { const source = prev[idx]; if (!source) return prev; const copy = { product:source.product,qty:1,note:'',spec:{ color:'',size:'',flavor:'' },price_option:'',snapshot:null }; return [...prev.slice(0,idx+1),copy,...prev.slice(idx+1)] }) }
  function updateCart(idx,patch) { setCartItems(p => p.map((item,i) => i === idx ? { ...item,...patch } : item)) }
  function updateQty(idx,value) { updateCart(idx,{ qty:value }) }
  const itemPrice = item => Number(item.snapshot?.sale_price ?? item.snapshot?.price ?? (item.product.price_options||[]).find(o=>o.label===item.price_option)?.price ?? item.product.price ?? 0)
  const total = cartItems.reduce((sum,item) => sum + itemPrice(item)*Number(item.qty || 0),0)

  async function save() {
    if (!formCustomer) { toast('請選擇客戶','error'); return }
    if (!cartItems.length) { toast('請加入至少一項商品','error'); return }
    for (const item of cartItems) {
      if (!Number.isInteger(Number(item.qty)) || Number(item.qty) < 1) { toast(`「${item.product.name}」數量至少為 1`,'error'); return }
      const err = validateSpec(item.product,item.spec,item.price_option); if (err) { toast(err,'error'); return }
    }
    setSaving(true)
    try {
      const items = cartItems.map(snapshotForCartItem)
      const payload = { customer_id:formCustomer.id,customer_name:formCustomer.name,customer_phone_last2:getCustomerPhoneLast2(formCustomer),customer_phone:formCustomer.phone || '',items,total_amount:items.reduce((s,i) => s+i.subtotal,0),note:orderNote.trim() }
      if (editId) { await OrdersAPI.update(editId,payload); toast('訂單已更新；到貨數量與歷史價格/成本快照已保留 ✓') }
      else { await OrdersAPI.create(payload); toast('訂單已開立 ✓') }
      setShowForm(false); await load()
    } catch (err) { toast('儲存失敗：'+err.message,'error') } finally { setSaving(false) }
  }
  async function setItemArrival(order,itemIndex,value) {
    try {
      const items = (order.items || []).map((item,index) => index !== itemIndex ? item : { ...item, arrived_qty:Math.min(itemQty(item),Math.max(0,Number(value || 0))), arrived_at:Number(value || 0) >= itemQty(item) ? new Date().toISOString() : null })
      await OrdersAPI.updateArrival(order.id,items)
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o,items } : o))
    } catch (err) { toast('到貨狀態更新失敗：'+err.message,'error') }
  }
  async function markAllArrived(order) {
    try {
      const now = new Date().toISOString(); const items = (order.items || []).map(item => ({ ...item, arrived_qty:itemQty(item), arrived_at:now }))
      await OrdersAPI.updateArrival(order.id,items); setOrders(prev => prev.map(o => o.id === order.id ? { ...o,items } : o)); toast('📦 此訂單商品已全部到貨；供應商付款仍依實際匯款狀態另外確認 ✓')
    } catch (err) { toast('到貨狀態更新失敗：'+err.message,'error') }
  }
  async function batchMarkAllArrived() {
    if (!selected.length) return
    const targets = orders.filter(order => selected.includes(order.id) && !order.archived && order.status !== 'cancelled')
    if (!targets.length) { toast('目前選取訂單沒有可更新的到貨資料','warning'); return }
    try {
      const at = new Date().toISOString()
      const updates = targets.map(order => ({
        order,
        items:(order.items || []).map(item => ({ ...item, arrived_qty:itemQty(item), arrived_at:at })),
      }))
      await Promise.all(updates.map(({ order,items }) => OrdersAPI.updateArrival(order.id,items)))
      const itemMap = Object.fromEntries(updates.map(({ order,items }) => [order.id,items]))
      setOrders(prev => prev.map(order => itemMap[order.id] ? { ...order,items:itemMap[order.id] } : order))
      toast(`📦 ${targets.length} 筆選取訂單已全部到貨；供應商付款狀態不會自動變更 ✓`)
    } catch (err) { toast('批次到貨更新失敗：'+err.message,'error') }
  }
  async function batchShip() { if (!selected.length) return; try { await OrdersAPI.batchUpdateStatus(selected,'shipped'); toast(`✅ ${selected.length} 筆訂單已出貨並自動標記已收款`); setSelected([]); await load() } catch (err) { toast('批次出貨失敗：'+err.message,'error') } }
  async function toggleShip(o) { try { const next=o.status === 'shipped' ? 'pending' : 'shipped'; await OrdersAPI.updateStatus(o.id,next); if(next==='shipped') toast('✅ 已出貨，收款狀態已自動改為已收款'); await load() } catch (err) { toast('更新失敗：'+err.message,'error') } }
  async function togglePayment(o) { try { if (['partial_refund','refunded'].includes(o.payment_status)) { toast('此訂單已有退款紀錄，如需重設請先使用「清除退款」','error'); return } const next = o.payment_status === 'unpaid' ? 'paid' : 'unpaid'; await OrdersAPI.updatePayment(o.id,next); toast(next === 'paid' ? '💰 已標記收款' : '↩️ 已取消收款'); await load() } catch (err) { toast('更新失敗：'+err.message,'error') } }
  async function togglePayable(o) { try { const next = o.payable_status === 'paid' ? 'unpaid' : 'paid'; await OrdersAPI.updatePayable(o.id,next); toast(next === 'paid' ? '✅ 已標記供應商付款' : '↩️ 已恢復供應商未付款'); await load() } catch (err) { toast('更新失敗：'+err.message,'error') } }
  async function confirmCancel() { if (!cancelOrder) return; try { await OrdersAPI.updateStatus(cancelOrder.id,'cancelled',{ reason:cancelReason.trim() }); toast('訂單已取消；報表將自動排除'); setCancelOrder(null); setCancelReason(''); await load() } catch (err) { toast('取消失敗：'+err.message,'error') } }
  async function restoreCancelled(o) { try { await OrdersAPI.updateStatus(o.id,'pending',{ reason:'恢復訂單' }); toast('訂單已恢復為待出貨'); await load() } catch (err) { toast('恢復失敗：'+err.message,'error') } }
  async function applyRefund() { if (!refundOrder) return; try { await OrdersAPI.applyRefund(refundOrder.id,{ amount:Number(refundAmount),note:refundNote.trim() }); toast('退款紀錄已保存，報表會扣除退款金額 ✓'); setRefundOrder(null); setRefundAmount(''); setRefundNote(''); await load() } catch (err) { toast('退款失敗：'+err.message,'error') } }
  async function clearRefunds(o) { try { await OrdersAPI.clearRefunds(o.id); toast('退款紀錄已清除，付款狀態恢復為已收款','warning'); await load() } catch (err) { toast('處理失敗：'+err.message,'error') } }
  async function archiveOrder(o) { try { await OrdersAPI.archive(o.id); setConfirmArchive(null); toast('訂單已封存，不會刪除歷史資料','warning'); await load() } catch (err) { toast('封存失敗：'+err.message,'error') } }
  function toggleSelect(id) { setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p,id]) }
  function toggleAll() { const ids = filtered.filter(o => o.status !== 'cancelled' && !o.archived).map(o => o.id); setSelected(p => p.length === ids.length && ids.length ? [] : ids) }

  const pendingCount = visibleOrders.filter(o => o.status === 'pending').length; const shippedCount = visibleOrders.filter(o => o.status === 'shipped').length
  const outstanding = visibleOrders.filter(o => o.status !== 'cancelled' && o.payment_status === 'unpaid').reduce((s,o) => s+effectiveOrderAmount(o),0)

  return <div className="animate-fade">
    <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:12 }}><div><h2 style={{ fontSize:22,fontWeight:800 }}>訂單管理</h2><p style={{ color:'var(--text-secondary)',fontSize:13,marginTop:2 }}>到貨與供應商付款分開管理；實際匯款才標記付款完成。已出貨仍自動同步已收款。</p></div><div style={{ display:'flex',gap:8,flexWrap:'wrap' }}><button className="btn btn-ghost btn-sm" onClick={() => setShowArchived(v => !v)}>{showArchived ? '隱藏封存' : '顯示封存'}</button>{selected.length > 0 && <><button className="btn btn-success btn-sm" onClick={batchMarkAllArrived} title="將選取訂單全部標記到貨；不會變更供應商付款狀態"><PackageCheck size={13}/>選取全部到貨 {selected.length}</button><button className="btn btn-primary btn-sm" onClick={batchShip}><CheckCircle size={13}/>批次出貨 {selected.length}</button><button className="btn btn-ghost btn-sm" onClick={() => setReceiptOrders(filtered.filter(o => selected.includes(o.id)))}><Printer size={13}/>出貨單</button></>}<button className="btn btn-primary" onClick={openAdd}><Plus size={15}/>開立訂單</button></div></div>

    <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:18 }}>
      <div style={{ background:'var(--amber-light)',borderRadius:10,padding:14 }}><div style={{ fontSize:12,color:'#b45309',fontWeight:700 }}>待出貨</div><strong style={{ fontSize:22,color:'#b45309' }}>{pendingCount}</strong></div>
      <div style={{ background:'var(--emerald-light)',borderRadius:10,padding:14 }}><div style={{ fontSize:12,color:'var(--emerald)',fontWeight:700 }}>已出貨</div><strong style={{ fontSize:22,color:'var(--emerald)' }}>{shippedCount}</strong></div>
      <div style={{ background:'var(--rose-light)',borderRadius:10,padding:14 }}><div style={{ fontSize:12,color:'var(--rose)',fontWeight:700 }}>未收款</div><strong style={{ fontSize:22,color:'var(--rose)' }}>NT${outstanding.toLocaleString()}</strong></div>
    </div>

    <div style={{ display:'flex',gap:8,marginBottom:14,flexWrap:'wrap' }}><div className="search-input-wrap" style={{ flex:1,minWidth:220 }}><Search size={14}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋客戶、手機末兩碼或商品..." style={{ padding:'8px 8px 8px 32px',width:'100%' }}/></div><select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="all">全部出貨狀態</option><option value="pending">待出貨</option><option value="shipped">已出貨</option><option value="cancelled">已取消</option></select><select value={filterPayment} onChange={e => setFilterPayment(e.target.value)}><option value="all">全部收款狀態</option><option value="unpaid">未收款</option><option value="paid">已收款</option><option value="partial_refund">部分退款</option><option value="refunded">已全額退款</option></select></div>

    <div className="card"><div className="table-container"><table><thead><tr><th><input type="checkbox" checked={selected.length > 0 && selected.length === filtered.filter(o => o.status !== 'cancelled' && !o.archived).length} onChange={toggleAll}/></th><th>客戶 / 商品 / 到貨</th><th>有效金額</th><th>出貨</th><th>收款</th><th>供應商款</th><th>日期</th><th style={{ textAlign:'right' }}>操作</th></tr></thead><tbody>
      {loading && <tr><td colSpan={8} style={{ textAlign:'center',padding:40 }}><div className="loading-spinner" style={{ margin:'0 auto' }}/></td></tr>}
      {!loading && filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign:'center',padding:30,color:'var(--text-muted)' }}>尚無訂單</td></tr>}
      {filtered.map(o => { const scfg = STATUS_CFG[o.status] || STATUS_CFG.pending; const pcfg = PAY_CFG[o.payment_status] || PAY_CFG.unpaid; const acfg = PAYABLE_CFG[o.payable_status] || PAYABLE_CFG.unpaid; const archived = o.archived === true; const phoneLast2 = orderPhoneLast2(o); const allArrived = (o.items || []).length > 0 && (o.items || []).every(item => arrivedQty(item) >= itemQty(item)); return <tr key={o.id} style={{ opacity:archived ? .5 : 1 }}>
        <td>{!archived && o.status !== 'cancelled' && <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggleSelect(o.id)}/>}</td>
        <td><div style={{ fontWeight:800 }}>{o.customer_name}{phoneLast2 && <span className="badge badge-indigo" style={{ marginLeft:6 }}>末碼 {phoneLast2}</span>}{archived && <span className="badge badge-gray" style={{ marginLeft:6 }}>封存</span>}</div>
          <div style={{ fontSize:12,color:'var(--text-secondary)',marginTop:5 }}>{(o.items || []).map((item,i) => { const arrival = arrivalLabel(item); const qty = itemQty(item); const arrived = arrivedQty(item); return <div key={i} style={{ display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',padding:'4px 0',borderBottom:i < o.items.length-1 ? '1px dashed var(--border)' : 'none' }}><span>{item.product_name || item.name}{specLabel(item)} ×{item.qty}</span><span className={`badge ${arrival.cls}`}>{arrival.label}</span>{!archived && o.status === 'pending' && <>{qty === 1 ? <button className="btn btn-sm btn-ghost" style={{ fontSize:10,padding:'2px 6px' }} onClick={() => setItemArrival(o,i,arrived ? 0 : 1)}>{arrived ? '改未到貨' : '✓ 已到貨'}</button> : <><span style={{ fontSize:10 }}>到</span><QuantityInput value={arrived} min={0} max={qty} onChange={value => setItemArrival(o,i,value)} ariaLabel={`${item.product_name || item.name}到貨數量`} style={{ width:58,padding:'3px 5px',fontSize:12 }}/><span style={{ fontSize:10 }}>/ {qty}</span><button className="btn btn-sm btn-ghost" style={{ fontSize:10,padding:'2px 6px' }} onClick={() => setItemArrival(o,i,qty)}>全到</button></>}</>}</div>})}</div>
          {!archived && o.status === 'pending' && !allArrived && (o.items || []).length > 1 && <button className="btn btn-sm btn-ghost" style={{ marginTop:5,fontSize:10 }} onClick={() => markAllArrived(o)}><PackageCheck size={10}/>整單全部到貨</button>}
          {o.cancellation_reason && <div style={{ fontSize:11,color:'var(--rose)',marginTop:3 }}>取消原因：{o.cancellation_reason}</div>}{Number(o.refund_amount || 0)>0 && <div style={{ fontSize:11,color:'#b45309' }}>已退款：NT${Number(o.refund_amount).toLocaleString()}</div>}
        </td>
        <td style={{ fontWeight:800,color:'var(--indigo)' }}>NT${effectiveOrderAmount(o).toLocaleString()}</td>
        <td><span className={`badge ${scfg.badge}`}>{scfg.label}</span>{!archived && o.status !== 'cancelled' && <button className="btn btn-sm btn-ghost" style={{ marginTop:4,fontSize:11 }} onClick={() => toggleShip(o)}>{o.status === 'shipped' ? <><RotateCcw size={10}/>取消出貨</> : <><CheckCircle size={10}/>標記出貨</>}</button>}</td>
        <td><span className={`badge ${pcfg.badge}`}>{pcfg.label}</span>{!archived && o.status !== 'cancelled' && <div style={{ display:'flex',gap:4,marginTop:4,flexWrap:'wrap' }}><button className="btn btn-sm btn-ghost" style={{ fontSize:11 }} onClick={() => togglePayment(o)}>{o.payment_status === 'unpaid' ? '收款完成' : '切換收款'}</button><button className="btn btn-sm btn-ghost" style={{ fontSize:11 }} onClick={() => { setRefundOrder(o); setRefundAmount(''); setRefundNote('') }}><Undo2 size={10}/>退款</button>{Number(o.refund_amount || 0)>0 && <button className="btn btn-sm btn-ghost" style={{ fontSize:11 }} onClick={() => clearRefunds(o)}>清除退款</button>}</div>}</td>
        <td><span className={`badge ${acfg.badge}`}>{acfg.label}</span><div style={{fontSize:10,color:'var(--text-muted)',marginTop:4}}>付款條件：{(()=>{const terms=[...new Set((o.items||[]).map(i=>i.supplier_payment_term||'manual'))];return terms.length===1?(PAYMENT_TERM_LABEL[terms[0]]||'手動付款'):'多種條件'})()}</div>{o.payable_status==='paid'&&o.payable_paid_at&&<div style={{fontSize:10,color:'var(--emerald)',marginTop:2}}>付款日：{new Date(o.payable_paid_at).toLocaleDateString('zh-TW')}</div>}{!archived && o.status !== 'cancelled' && <button className="btn btn-sm btn-ghost" style={{ marginTop:4,fontSize:11 }} onClick={() => togglePayable(o)}><WalletCards size={10}/>{o.payable_status === 'paid' ? '取消付款' : '付款完成'}</button>}</td>
        <td style={{ color:'var(--text-secondary)',fontSize:13 }}>{o.order_date ? new Date(o.order_date).toLocaleDateString('zh-TW') : '—'}</td>
        <td style={{ textAlign:'right' }}><div style={{ display:'flex',gap:5,justifyContent:'flex-end',flexWrap:'wrap' }}><button className="btn-icon btn" title="出貨單" onClick={() => setReceiptOrders([o])}><Printer size={12}/></button>{!archived && o.status !== 'cancelled' && <button className="btn-icon btn" title="編輯" onClick={() => openEdit(o)}><Pencil size={12}/></button>}{!archived && o.status !== 'cancelled' && <button className="btn-icon btn" title="取消訂單" onClick={() => { setCancelOrder(o); setCancelReason('') }} style={{ color:'var(--rose)' }}><AlertCircle size={12}/></button>}{!archived && o.status === 'cancelled' && <button className="btn-icon btn" title="恢復訂單" onClick={() => restoreCancelled(o)}><RotateCcw size={12}/></button>}{!archived && <button className="btn-icon btn" title="封存" onClick={() => setConfirmArchive(o)}><Archive size={12}/></button>}<OrderDeleteButton order={o} onDeleted={load}/></div></td>
      </tr>})}
    </tbody></table></div></div>

    {showForm && <Modal title={editId ? '編輯訂單' : '開立新訂單'} onClose={() => setShowForm(false)} width={700}>
      <div className="form-group"><label>客戶 *</label><div className="dropdown" ref={custRef}><button type="button" className="btn btn-ghost" style={{ width:'100%',justifyContent:'space-between' }} onClick={() => setCustOpen(v => !v)}><span>{formCustomer ? `${formCustomer.name}${getCustomerPhoneLast2(formCustomer) ? `（末碼 ${getCustomerPhoneLast2(formCustomer)}）` : ''}` : '搜尋並選擇客戶...'}</span><ChevronDown size={14}/></button>{custOpen && <div className="dropdown-menu" style={{ width:'100%',maxHeight:320,overflowY:'auto' }}><div style={{ padding:8 }}><input autoFocus value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="姓名 / 手機末兩碼 / 完整電話 / Line / FB"/></div>{filtCusts.slice(0,50).map(c => <div key={c.id} className="dropdown-item" onClick={() => { setFormCustomer(c); setCustOpen(false) }}><div style={{ flex:1 }}><strong>{c.name}</strong><div style={{ fontSize:11,color:'var(--text-muted)',marginTop:2 }}>{customerSecondaryLabel(c) || '無其他辨識資料'}</div></div></div>)}</div>}</div></div>
      <div className="form-group"><label>加入商品</label><div className="dropdown" ref={prodRef}><button type="button" className="btn btn-ghost" style={{ width:'100%',justifyContent:'space-between' }} onClick={() => setProdOpen(v => !v)}><span>搜尋並加入商品（同商品可加入多次不同口味/規格）</span><ChevronDown size={14}/></button>{prodOpen && <div className="dropdown-menu" style={{ width:'100%' }}><div style={{ padding:8 }}><input autoFocus value={prodSearch} onChange={e => setProdSearch(e.target.value)} placeholder="商品名稱"/></div>{filtProds.slice(0,40).map(p => <div key={p.id} className="dropdown-item" onClick={() => addToCart(p)}><span style={{ flex:1 }}>{p.name}</span><strong style={{ color:'var(--indigo)' }}>NT${p.price}</strong></div>)}</div>}</div></div>
      {cartItems.map((item,idx) => { const price = itemPrice(item); return <div key={idx} style={{ borderBottom:'1px dashed var(--border)',padding:'10px 0' }}><div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' }}><strong style={{ flex:1,minWidth:140 }}>{item.product.name}</strong>{(item.product.price_options||[]).length>0&&<select value={item.price_option||''} onChange={e=>updateCart(idx,{price_option:e.target.value})} disabled={Boolean(item.snapshot)} style={{fontWeight:800,border:'1.5px solid var(--emerald)'}}><option value="">💰 選組合／包裝 *</option>{item.product.price_options.map(opt=><option key={opt.label} value={opt.label}>{opt.label}｜NT${Number(opt.price||0).toLocaleString()}</option>)}</select>}<button type="button" className="btn btn-sm btn-ghost" onClick={() => addSameProduct(idx)} title="再加入一筆相同商品"><Plus size={12}/>同商品</button><input value={item.note} onChange={e => updateCart(idx,{ note:e.target.value })} placeholder="備註" style={{ maxWidth:150 }}/><span>NT${Number(price).toLocaleString()}</span><QuantityInput value={item.qty} min={1} onChange={value => updateQty(idx,value)} ariaLabel={`${item.product.name}數量`} style={{ width:75 }}/><strong style={{ minWidth:90,textAlign:'right',color:'var(--indigo)' }}>NT${(Number(price)*Number(item.qty || 0)).toLocaleString()}</strong><button type="button" onClick={() => setCartItems(p => p.filter((_,i) => i !== idx))} style={{ border:'none',background:'none',color:'var(--rose)',cursor:'pointer' }}><X size={14}/></button></div><SpecSelector product={item.product} value={item.spec} onChange={spec => updateCart(idx,{ spec })}/>{item.snapshot && <div style={{ fontSize:10,color:'var(--text-muted)',marginTop:4 }}>歷史快照：售價 NT${Number(price).toLocaleString()}／成本 NT${Number(item.snapshot.cost_price ?? 0).toLocaleString()}／到貨 {arrivedQty(item.snapshot)}/{itemQty(item.snapshot)}</div>}</div> })}
      {cartItems.length > 0 && <div style={{ textAlign:'right',fontSize:18,fontWeight:900,color:'var(--indigo)',margin:'12px 0' }}>合計：NT${total.toLocaleString()}</div>}<div className="form-group"><label>訂單備註</label><input value={orderNote} onChange={e => setOrderNote(e.target.value)}/></div><div style={{ display:'flex',gap:10,justifyContent:'flex-end' }}><button className="btn btn-ghost" onClick={() => setShowForm(false)}>取消</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '處理中...' : '儲存訂單'}</button></div>
    </Modal>}

    {cancelOrder && <Modal title="取消訂單" onClose={() => setCancelOrder(null)} width={430}><div style={{ background:'var(--rose-light)',padding:10,borderRadius:8,marginBottom:14,fontSize:13 }}>取消後不會刪除資料，報表、營收、毛利都會自動排除此訂單。</div><div className="form-group"><label>取消原因</label><input value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="例如：客戶取消、缺貨"/></div><div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}><button className="btn btn-ghost" onClick={() => setCancelOrder(null)}>返回</button><button className="btn" style={{ background:'var(--rose)',color:'#fff' }} onClick={confirmCancel}>確認取消</button></div></Modal>}
    {refundOrder && <Modal title="新增退款紀錄" onClose={() => setRefundOrder(null)} width={430}><div style={{ background:'var(--amber-light)',padding:10,borderRadius:8,marginBottom:14,fontSize:13 }}>訂單原額 NT${Number(refundOrder.total_amount || 0).toLocaleString()}；已退款 NT${Number(refundOrder.refund_amount || 0).toLocaleString()}。</div><div className="form-group"><label>本次退款金額 *</label><input type="number" min="1" value={refundAmount} onChange={e => setRefundAmount(e.target.value)}/></div><div className="form-group"><label>退款原因 / 備註</label><input value={refundNote} onChange={e => setRefundNote(e.target.value)} placeholder="例如：缺貨退款"/></div><div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}><button className="btn btn-ghost" onClick={() => setRefundOrder(null)}>取消</button><button className="btn btn-primary" onClick={applyRefund}><DollarSign size={13}/>記錄退款</button></div></Modal>}
    {receiptOrders && <GroupedReceipt orders={receiptOrders} onClose={() => setReceiptOrders(null)}/>} 
    {confirmArchive && <ConfirmDialog message={`確定要封存「${confirmArchive.customer_name}」的訂單？\n封存不會刪除帳務與歷史資料。`} onConfirm={() => archiveOrder(confirmArchive)} onCancel={() => setConfirmArchive(null)}/>} 
  </div>
}
