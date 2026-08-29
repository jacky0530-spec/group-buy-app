import { useState, useEffect, useCallback, useRef } from 'react'
import { OrdersAPI, ProductsAPI, CustomersAPI, snapshotOrderItem, effectiveOrderAmount } from '../lib/db'
import { useToast, Modal, ConfirmDialog } from '../components/UI'
import QuantityInput from '../components/QuantityInput'
import OrderDeleteButton from '../components/OrderDeleteButton'
import GroupedReceipt from '../components/GroupedReceipt'
import { customerSecondaryLabel, filterCustomers, getCustomerPhoneLast2 } from '../lib/customerSearch'
import { Plus, Pencil, Archive, Search, ChevronDown, X, Printer, CheckCircle, Clock, AlertCircle, RotateCcw, DollarSign, Undo2, WalletCards, PackageCheck, Trash2 } from 'lucide-react'

const STATUS_CFG = {
  pending:{ label:'待出貨',badge:'badge-amber',icon:Clock }, shipped:{ label:'已出貨',badge:'badge-emerald',icon:CheckCircle }, cancelled:{ label:'已取消',badge:'badge-rose',icon:AlertCircle },
}
const PAY_CFG = {
  unpaid:{ label:'未收款',badge:'badge-rose' }, paid:{ label:'已收款',badge:'badge-emerald' }, partial_refund:{ label:'部分退款',badge:'badge-amber' }, refunded:{ label:'已全額退款',badge:'badge-gray' },
}
const money = value => `NT$${Math.round(Number(value || 0)).toLocaleString()}`
const PAYMENT_TERM_LABEL = { order:'訂貨即付款', arrival:'到貨後付款', manual:'手動付款' }
const FIRST_PAGE_SIZE = 60
const BACKGROUND_PAGE_SIZE = 250
const RENDER_PAGE_SIZE = 100

function supplierPaymentSummary(order) {
  const rows = (order?.items || []).map(item => {
    const total = Number(item.cost_price || 0) * Number(item.qty || 0)
    const paid = Math.min(total,Math.max(0,Number(item.supplier_paid_amount || 0)))
    return { total,paid }
  })
  const total = rows.reduce((s,r)=>s+r.total,0)
  const paid = rows.reduce((s,r)=>s+r.paid,0)
  const status = paid >= total - 0.01 && total > 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
  return { total,paid,outstanding:Math.max(0,total-paid),status }
}

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
function mergeOrderPages(current,incoming) {
  const seen = new Set(current.map(order => order.id))
  const fresh = (incoming || []).filter(order => order?.id && !seen.has(order.id))
  return fresh.length ? [...current,...fresh] : current
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

export default function OrdersFast() {
  const toast = useToast()
  const [orders,setOrders] = useState([]); const [products,setProducts] = useState([]); const [customers,setCustomers] = useState([]); const [loading,setLoading] = useState(true)
  const [historyLoading,setHistoryLoading] = useState(false); const [orderSummary,setOrderSummary] = useState(null); const [renderLimit,setRenderLimit] = useState(RENDER_PAGE_SIZE)
  const [search,setSearch] = useState(''); const [filterStatus,setFilterStatus] = useState('all'); const [filterPayment,setFilterPayment] = useState('all'); const [filterProduct,setFilterProduct] = useState('all'); const [filterProductSearch,setFilterProductSearch] = useState(''); const [filterProductOpen,setFilterProductOpen] = useState(false); const [filterDateFrom,setFilterDateFrom] = useState(''); const [filterDateTo,setFilterDateTo] = useState(''); const [showArchived,setShowArchived] = useState(false); const [selected,setSelected] = useState([])
  const [showForm,setShowForm] = useState(false); const [editId,setEditId] = useState(null); const [formCustomer,setFormCustomer] = useState(null); const [custSearch,setCustSearch] = useState(''); const [custOpen,setCustOpen] = useState(false)
  const [cartItems,setCartItems] = useState([]); const [prodSearch,setProdSearch] = useState(''); const [prodOpen,setProdOpen] = useState(false); const [orderNote,setOrderNote] = useState(''); const [formVirtual,setFormVirtual] = useState(false); const [saving,setSaving] = useState(false)
  const [receiptOrders,setReceiptOrders] = useState(null); const [confirmArchive,setConfirmArchive] = useState(null); const [cancelOrder,setCancelOrder] = useState(null); const [cancelReason,setCancelReason] = useState(''); const [refundOrder,setRefundOrder] = useState(null); const [refundAmount,setRefundAmount] = useState(''); const [refundNote,setRefundNote] = useState('')
  const custRef = useRef(null); const prodRef = useRef(null); const filterProdRef = useRef(null); const loadSeqRef = useRef(0)

  useEffect(() => { const handler=e => { if (custRef.current && !custRef.current.contains(e.target)) setCustOpen(false); if (prodRef.current && !prodRef.current.contains(e.target)) setProdOpen(false); if (filterProdRef.current && !filterProdRef.current.contains(e.target)) setFilterProductOpen(false) }; document.addEventListener('mousedown',handler); return () => document.removeEventListener('mousedown',handler) },[])
  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current
    setLoading(true); setHistoryLoading(true); setRenderLimit(RENDER_PAGE_SIZE)

    void ProductsAPI.list().then(rows => { if (seq === loadSeqRef.current) setProducts(rows) }).catch(err => { if (seq === loadSeqRef.current) toast('商品資料載入失敗：'+err.message,'error') })
    void CustomersAPI.list().then(rows => { if (seq === loadSeqRef.current) setCustomers(rows) }).catch(err => { if (seq === loadSeqRef.current) toast('客戶資料載入失敗：'+err.message,'error') })
    if (typeof OrdersAPI.summary === 'function') {
      void OrdersAPI.summary().then(summary => { if (seq === loadSeqRef.current) setOrderSummary(summary) }).catch(err => { console.warn('order summary load failed',err) })
    }

    try {
      const first = await OrdersAPI.listPage({ pageSize:FIRST_PAGE_SIZE })
      if (seq !== loadSeqRef.current) return
      setOrders(first.rows || [])
      setLoading(false)

      if (!first.hasMore || !first.nextCursor) {
        setHistoryLoading(false)
        return
      }

      void (async () => {
        let cursor = first.nextCursor
        let hasMore = first.hasMore
        try {
          while (hasMore && cursor && seq === loadSeqRef.current) {
            const page = await OrdersAPI.listPage({ pageSize:BACKGROUND_PAGE_SIZE,cursor })
            if (seq !== loadSeqRef.current) return
            setOrders(prev => mergeOrderPages(prev,page.rows))
            cursor = page.nextCursor
            hasMore = page.hasMore
            await new Promise(resolve => setTimeout(resolve,0))
          }
        } catch (err) {
          if (seq === loadSeqRef.current) toast('歷史訂單背景載入失敗：'+err.message,'warning')
        } finally {
          if (seq === loadSeqRef.current) setHistoryLoading(false)
        }
      })()
    } catch (err) {
      if (seq === loadSeqRef.current) {
        setLoading(false); setHistoryLoading(false)
        toast('載入失敗：'+err.message,'error')
      }
    }
  },[toast])
  useEffect(() => { load(); return () => { loadSeqRef.current += 1 } },[load])
  useEffect(() => { setSelected([]); setRenderLimit(RENDER_PAGE_SIZE) },[search,filterStatus,filterPayment,filterProduct,filterDateFrom,filterDateTo,showArchived])

  const prodMap = Object.fromEntries(products.map(p => [p.id,p])); const customerMap = Object.fromEntries(customers.map(c => [c.id,c])); const visibleOrders = orders.filter(o => showArchived ? true : !o.archived)
  const orderPhoneLast2 = o => String(o.customer_phone_last2 || getCustomerPhoneLast2(customerMap[o.customer_id]) || '').trim()
  const filtered = visibleOrders.filter(o => { const q = search.toLowerCase().trim(); const ms = (o.customer_name || '').toLowerCase().includes(q) || orderPhoneLast2(o).toLowerCase().includes(q) || String(o.customer_phone || customerMap[o.customer_id]?.phone || '').includes(search.trim()) || (o.items || []).some(i => (i.product_name || i.name || '').toLowerCase().includes(q)); const productMatch = filterProduct === 'all' || (o.items || []).some(i => (i.product_id || i.id) === filterProduct); const orderDate = o.order_date ? new Date(o.order_date) : null; const orderDay = orderDate && !Number.isNaN(orderDate.getTime()) ? `${orderDate.getFullYear()}-${String(orderDate.getMonth()+1).padStart(2,'0')}-${String(orderDate.getDate()).padStart(2,'0')}` : ''; const dateMatch = (!filterDateFrom || orderDay >= filterDateFrom) && (!filterDateTo || orderDay <= filterDateTo); return ms && productMatch && dateMatch && (filterStatus === 'all' || o.status === filterStatus) && (filterPayment === 'all' || o.payment_status === filterPayment) })
  const displayed = filtered.slice(0,renderLimit)
  const filtCusts = filterCustomers(customers,custSearch)
  const filtProds = products.filter(p => p.name.toLowerCase().includes(prodSearch.toLowerCase()))
  const sortedFilterProducts = [...products].sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''),'zh-Hant'))
  const matchedFilterProducts = sortedFilterProducts.filter(p => String(p.name || '').toLowerCase().includes(filterProductSearch.trim().toLowerCase())).slice(0,30)
  const selectedFilterProductName = products.find(p => p.id === filterProduct)?.name || ''
  const hasOrderFilters = filterProduct !== 'all' || filterDateFrom || filterDateTo

  function openAdd() { setEditId(null); setFormCustomer(null); setCartItems([]); setOrderNote(''); setFormVirtual(false); setCustSearch(''); setProdSearch(''); setShowForm(true) }
  function productFromSnapshot(item) { const id = item.product_id || item.id; return prodMap[id] || { id,name:item.product_name || item.name,price:item.sale_price ?? item.price ?? 0,cost:item.cost_price ?? 0,category:item.category || 'other',supplier:item.supplier || '',supplier_payment_term:item.supplier_payment_term||'manual',spec_mode:'none',spec_flavors:item.spec?.flavor ? [item.spec.flavor] : [],spec_colors:item.spec?.color ? [item.spec.color] : [],spec_sizes:item.spec?.size ? [item.spec.size] : [],price_options:item.spec?.package ? [{label:item.spec.package,price:item.sale_price ?? item.price ?? 0,cost:item.cost_price ?? ''}] : [] } }
  function openEdit(o) { const customer = customers.find(c => c.id === o.customer_id) || { id:o.customer_id,name:o.customer_name,phone:o.customer_phone || '',phone_last2:o.customer_phone_last2 || '' }; setEditId(o.id); setFormCustomer(customer); setCartItems((o.items || []).map(item => ({ product:productFromSnapshot(item),qty:item.qty,note:item.note || '',spec:item.spec || {},price_option:item.spec?.package || '',snapshot:item }))); setOrderNote(o.note || ''); setFormVirtual(Boolean(o.is_virtual)); setShowForm(true) }
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
      const payload = { customer_id:formCustomer.id,customer_name:formCustomer.name,customer_phone_last2:getCustomerPhoneLast2(formCustomer),customer_phone:formCustomer.phone || '',items,total_amount:items.reduce((s,i) => s+i.subtotal,0),note:orderNote.trim(),is_virtual:formVirtual }
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

  async function bulkDeleteSelected() {
    const targets = filtered.filter(o => selected.includes(o.id) && !o.archived && o.status !== 'cancelled')
    if (!targets.length) { toast('目前沒有可永久刪除的已選訂單','warning'); return }
    const productText = filterProduct === 'all' ? '全部商品' : (products.find(p => p.id === filterProduct)?.name || '指定商品')
    const dateText = filterDateFrom || filterDateTo ? `${filterDateFrom || '最早'} ～ ${filterDateTo || '今天'}` : '全部日期'
    const first = window.confirm(`確定要永久刪除目前選取的 ${targets.length} 筆訂單？\n\n商品條件：${productText}\n日期條件：${dateText}\n\n刪除後無法復原。`)
    if (!first) return
    const second = window.confirm(`再次確認：永久刪除 ${targets.length} 筆訂單，並同步清理相關供應商付款分配。確定繼續？`)
    if (!second) return
    try {
      const result = await OrdersAPI.bulkHardDelete(targets.map(o => o.id))
      setSelected([])
      toast(`🗑️ 已永久刪除 ${result.deleted} 筆訂單；相關付款紀錄已同步整理`,'warning')
      await load()
    } catch (err) {
      toast('批次永久刪除失敗：'+err.message,'error')
    }
  }
  async function batchShip() { if (!selected.length) return; try { await OrdersAPI.batchUpdateStatus(selected,'shipped'); toast(`✅ ${selected.length} 筆訂單已出貨並自動標記已收款`); setSelected([]); await load() } catch (err) { toast('批次出貨失敗：'+err.message,'error') } }
  async function toggleShip(o) { try { const next=o.status === 'shipped' ? 'pending' : 'shipped'; await OrdersAPI.updateStatus(o.id,next); if(next==='shipped') toast('✅ 已出貨，收款狀態已自動改為已收款'); await load() } catch (err) { toast('更新失敗：'+err.message,'error') } }
  async function togglePayment(o) { try { if (['partial_refund','refunded'].includes(o.payment_status)) { toast('此訂單已有退款紀錄，如需重設請先使用「清除退款」','error'); return } const next = o.payment_status === 'unpaid' ? 'paid' : 'unpaid'; await OrdersAPI.updatePayment(o.id,next); toast(next === 'paid' ? '💰 已標記收款' : '↩️ 已取消收款'); await load() } catch (err) { toast('更新失敗：'+err.message,'error') } }
  async function confirmCancel() { if (!cancelOrder) return; try { await OrdersAPI.updateStatus(cancelOrder.id,'cancelled',{ reason:cancelReason.trim() }); toast('訂單已取消；報表將自動排除'); setCancelOrder(null); setCancelReason(''); await load() } catch (err) { toast('取消失敗：'+err.message,'error') } }
  async function restoreCancelled(o) { try { await OrdersAPI.updateStatus(o.id,'pending',{ reason:'恢復訂單' }); toast('訂單已恢復為待出貨'); await load() } catch (err) { toast('恢復失敗：'+err.message,'error') } }
  async function applyRefund() { if (!refundOrder) return; try { await OrdersAPI.applyRefund(refundOrder.id,{ amount:Number(refundAmount),note:refundNote.trim() }); toast('退款紀錄已保存，報表會扣除退款金額 ✓'); setRefundOrder(null); setRefundAmount(''); setRefundNote(''); await load() } catch (err) { toast('退款失敗：'+err.message,'error') } }
  async function clearRefunds(o) { try { await OrdersAPI.clearRefunds(o.id); toast('退款紀錄已清除，付款狀態恢復為已收款','warning'); await load() } catch (err) { toast('處理失敗：'+err.message,'error') } }
  async function archiveOrder(o) { try { await OrdersAPI.archive(o.id); setConfirmArchive(null); toast('訂單已封存，不會刪除歷史資料','warning'); await load() } catch (err) { toast('封存失敗：'+err.message,'error') } }
  function toggleSelect(id) { setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p,id]) }
  function toggleAll() {
    if (historyLoading) { toast('歷史訂單仍在背景載入，完成後再使用全選','warning'); return }
    const ids = filtered.filter(o => o.status !== 'cancelled' && !o.archived).map(o => o.id)
    setSelected(p => p.length === ids.length && ids.length ? [] : ids)
  }

  const localPendingCount = visibleOrders.filter(o => o.status === 'pending' && !o.is_virtual).length; const localShippedCount = visibleOrders.filter(o => o.status === 'shipped' && !o.is_virtual).length; const localVirtualCount = visibleOrders.filter(o => o.status !== 'cancelled' && o.is_virtual).length
  const localOutstanding = visibleOrders.filter(o => o.status !== 'cancelled' && !o.is_virtual && o.payment_status === 'unpaid').reduce((s,o) => s+effectiveOrderAmount(o),0)
  const useFastSummary = !showArchived && orderSummary
  const pendingCount = useFastSummary ? orderSummary.pendingCount : localPendingCount
  const shippedCount = useFastSummary ? orderSummary.shippedCount : localShippedCount
  const virtualCount = useFastSummary ? orderSummary.virtualCount : localVirtualCount
  const outstanding = useFastSummary ? orderSummary.outstanding : localOutstanding

  return <div className="animate-fade">
    <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:12 }}><div><h2 style={{ fontSize:22,fontWeight:800 }}>訂單管理</h2><p style={{ color:'var(--text-secondary)',fontSize:13,marginTop:2 }}>到貨與供應商付款分開管理；實際匯款才標記付款完成。已出貨仍自動同步已收款。</p></div><div style={{ display:'flex',gap:8,flexWrap:'wrap' }}><button className="btn btn-ghost btn-sm" onClick={() => setShowArchived(v => !v)}>{showArchived ? '隱藏封存' : '顯示封存'}</button>{selected.length > 0 && <><button className="btn btn-success btn-sm" onClick={batchMarkAllArrived} title="將選取訂單全部標記到貨；不會變更供應商付款狀態"><PackageCheck size={13}/>選取全部到貨 {selected.length}</button><button className="btn btn-primary btn-sm" onClick={batchShip}><CheckCircle size={13}/>批次出貨 {selected.length}</button><button className="btn btn-ghost btn-sm" onClick={() => setReceiptOrders(filtered.filter(o => selected.includes(o.id)))}><Printer size={13}/>出貨單</button><button className="btn btn-sm" onClick={bulkDeleteSelected} style={{background:'var(--rose)',color:'white',borderColor:'var(--rose)'}} title="永久刪除目前篩選後已選取的訂單"><Trash2 size={13}/>一鍵刪除 {selected.length}</button></>}<button className="btn btn-primary" onClick={openAdd}><Plus size={15}/>開立訂單</button></div></div>

    <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:18 }}>
      <div style={{ background:'var(--amber-light)',borderRadius:10,padding:14 }}><div style={{ fontSize:12,color:'#b45309',fontWeight:700 }}>待出貨</div><strong style={{ fontSize:22,color:'#b45309' }}>{pendingCount}</strong></div>
      <div style={{ background:'var(--emerald-light)',borderRadius:10,padding:14 }}><div style={{ fontSize:12,color:'var(--emerald)',fontWeight:700 }}>已出貨</div><strong style={{ fontSize:22,color:'var(--emerald)' }}>{shippedCount}</strong></div><div style={{ background:'#fff1f2',borderRadius:10,padding:14,border:'1px solid #fecdd3' }}><div style={{ fontSize:12,color:'#be123c',fontWeight:800 }}>⚠ 虛擬訂單</div><strong style={{ fontSize:22,color:'#be123c' }}>{virtualCount}</strong></div>
      <div style={{ background:'var(--rose-light)',borderRadius:10,padding:14 }}><div style={{ fontSize:12,color:'var(--rose)',fontWeight:700 }}>未收款</div><strong style={{ fontSize:22,color:'var(--rose)' }}>NT${outstanding.toLocaleString()}</strong></div>
    </div>

    <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:12,marginBottom:14}}><div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}><div className="search-input-wrap" style={{ flex:'1 1 260px',minWidth:220 }}><Search size={14}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋客戶、手機末兩碼或商品..." style={{ padding:'8px 8px 8px 32px',width:'100%' }}/></div><div ref={filterProdRef} style={{position:'relative',flex:'0 1 260px',minWidth:220}}><div className="search-input-wrap"><Search size={14}/><input value={filterProductOpen ? filterProductSearch : selectedFilterProductName} onFocus={()=>{setFilterProductOpen(true);setFilterProductSearch('')}} onChange={e=>{setFilterProductSearch(e.target.value);setFilterProductOpen(true)}} placeholder="📦 輸入商品名稱篩選..." style={{padding:'8px 34px 8px 32px',width:'100%'}} />{filterProduct !== 'all' && <button type="button" onClick={()=>{setFilterProduct('all');setFilterProductSearch('');setFilterProductOpen(false)}} title="清除商品篩選" style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',border:'none',background:'transparent',cursor:'pointer',color:'var(--text-muted)',padding:2}}><X size={14}/></button>}</div>{filterProductOpen&&<div style={{position:'absolute',zIndex:30,top:'calc(100% + 4px)',left:0,right:0,maxHeight:300,overflowY:'auto',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,boxShadow:'0 10px 30px rgba(15,23,42,.14)'}}><button type="button" onClick={()=>{setFilterProduct('all');setFilterProductSearch('');setFilterProductOpen(false)}} style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',border:'none',borderBottom:'1px solid var(--border)',background:filterProduct==='all'?'var(--indigo-light)':'transparent',cursor:'pointer',fontFamily:'inherit',fontWeight:800}}>📦 全部商品</button>{matchedFilterProducts.map(p=><button type="button" key={p.id} onClick={()=>{setFilterProduct(p.id);setFilterProductSearch('');setFilterProductOpen(false)}} style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',border:'none',borderBottom:'1px solid var(--border)',background:filterProduct===p.id?'var(--indigo-light)':'transparent',cursor:'pointer',fontFamily:'inherit'}}>{p.name}</button>)}{matchedFilterProducts.length===0&&<div style={{padding:'12px',color:'var(--text-muted)',fontSize:12}}>找不到符合的商品</div>}</div>}</div><label style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--text-secondary)'}}>起日<input type="date" value={filterDateFrom} onChange={e=>setFilterDateFrom(e.target.value)} /></label><label style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--text-secondary)'}}>迄日<input type="date" value={filterDateTo} onChange={e=>setFilterDateTo(e.target.value)} /></label><select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="all">全部出貨狀態</option><option value="pending">待出貨</option><option value="shipped">已出貨</option><option value="cancelled">已取消</option></select><select value={filterPayment} onChange={e => setFilterPayment(e.target.value)}><option value="all">全部收款狀態</option><option value="unpaid">未收款</option><option value="paid">已收款</option><option value="partial_refund">部分退款</option><option value="refunded">已全額退款</option></select>{hasOrderFilters&&<button className="btn btn-sm btn-ghost" onClick={()=>{setFilterProduct('all');setFilterProductSearch('');setFilterProductOpen(false);setFilterDateFrom('');setFilterDateTo('')}}><RotateCcw size={12}/>清除商品／日期</button>}</div><div style={{fontSize:11,color:'var(--text-muted)',marginTop:8}}>{historyLoading ? <>已載入篩選結果 <strong>{filtered.length}</strong> 筆；歷史訂單正在背景載入（目前已載入 {orders.length} 筆），畫面可先操作。</> : <>目前篩選結果 <strong>{filtered.length}</strong> 筆。表頭全選只會勾選目前篩選後可操作的訂單；選取後可一鍵永久刪除。</>}</div></div>

    <div className="card"><div className="table-container"><table><thead><tr><th><input type="checkbox" checked={selected.length > 0 && selected.length === filtered.filter(o => o.status !== 'cancelled' && !o.archived).length} onChange={toggleAll}/></th><th>客戶 / 商品 / 到貨</th><th>有效金額</th><th>出貨</th><th>收款</th><th>供應商款</th><th>日期</th><th style={{ textAlign:'right' }}>操作</th></tr></thead><tbody>
      {loading && <tr><td colSpan={8} style={{ textAlign:'center',padding:40 }}><div className="loading-spinner" style={{ margin:'0 auto' }}/><div style={{fontSize:11,color:'var(--text-muted)',marginTop:8}}>先載入最近 {FIRST_PAGE_SIZE} 筆訂單...</div></td></tr>}
      {!loading && filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign:'center',padding:30,color:'var(--text-muted)' }}>{historyLoading?'正在載入歷史訂單...':'尚無訂單'}</td></tr>}
      {displayed.map(o => { const scfg = STATUS_CFG[o.status] || STATUS_CFG.pending; const pcfg = PAY_CFG[o.payment_status] || PAY_CFG.unpaid; const supplierPay = supplierPaymentSummary(o); const archived = o.archived === true; const phoneLast2 = orderPhoneLast2(o); const allArrived = (o.items || []).length > 0 && (o.items || []).every(item => arrivedQty(item) >= itemQty(item)); return <tr key={o.id} style={{ opacity:archived ? .5 : 1,background:o.is_virtual?'#fff1f2':undefined }}>
        <td>{!archived && o.status !== 'cancelled' && <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggleSelect(o.id)}/>}</td>
        <td><div style={{ fontWeight:800 }}>{o.customer_name}{o.is_virtual&&<span className="badge badge-rose" style={{marginLeft:6,fontWeight:900}}>⚠ 虛擬</span>}{phoneLast2 && <span className="badge badge-indigo" style={{ marginLeft:6 }}>末碼 {phoneLast2}</span>}{archived && <span className="badge badge-gray" style={{ marginLeft:6 }}>封存</span>}</div>
          <div style={{ fontSize:12,color:'var(--text-secondary)',marginTop:5 }}>{(o.items || []).map((item,i) => { const arrival = arrivalLabel(item); const qty = itemQty(item); const arrived = arrivedQty(item); return <div key={i} style={{ display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',padding:'4px 0',borderBottom:i < o.items.length-1 ? '1px dashed var(--border)' : 'none' }}><span>{item.product_name || item.name}{specLabel(item)} ×{item.qty}</span><span className={`badge ${arrival.cls}`}>{arrival.label}</span>{!archived && o.status === 'pending' && <>{qty === 1 ? <button className="btn btn-sm btn-ghost" style={{ fontSize:10,padding:'2px 6px' }} onClick={() => setItemArrival(o,i,arrived ? 0 : 1)}>{arrived ? '改未到貨' : '✓ 已到貨'}</button> : <><span style={{ fontSize:10 }}>到</span><QuantityInput value={arrived} min={0} max={qty} onChange={value => setItemArrival(o,i,value)} ariaLabel={`${item.product_name || item.name}到貨數量`} style={{ width:58,padding:'3px 5px',fontSize:12 }}/><span style={{ fontSize:10 }}>/ {qty}</span><button className="btn btn-sm btn-ghost" style={{ fontSize:10,padding:'2px 6px' }} onClick={() => setItemArrival(o,i,qty)}>全到</button></>}</>}</div>})}</div>
          {!archived && o.status === 'pending' && !allArrived && (o.items || []).length > 1 && <button className="btn btn-sm btn-ghost" style={{ marginTop:5,fontSize:10 }} onClick={() => markAllArrived(o)}><PackageCheck size={10}/>整單全部到貨</button>}
          {o.cancellation_reason && <div style={{ fontSize:11,color:'var(--rose)',marginTop:3 }}>取消原因：{o.cancellation_reason}</div>}{Number(o.refund_amount || 0)>0 && <div style={{ fontSize:11,color:'#b45309' }}>已退款：NT${Number(o.refund_amount).toLocaleString()}</div>}
        </td>
        <td style={{ fontWeight:800,color:'var(--indigo)' }}>NT${effectiveOrderAmount(o).toLocaleString()}</td>
        <td><span className={`badge ${scfg.badge}`}>{scfg.label}</span>{!archived && o.status !== 'cancelled' && <button className="btn btn-sm btn-ghost" style={{ marginTop:4,fontSize:11 }} onClick={() => toggleShip(o)}>{o.status === 'shipped' ? <><RotateCcw size={10}/>取消出貨</> : <><CheckCircle size={10}/>標記出貨</>}</button>}</td>
        <td><span className={`badge ${pcfg.badge}`}>{pcfg.label}</span>{!archived && o.status !== 'cancelled' && <div style={{ display:'flex',gap:4,marginTop:4,flexWrap:'wrap' }}><button className="btn btn-sm btn-ghost" style={{ fontSize:11 }} onClick={() => togglePayment(o)}>{o.payment_status === 'unpaid' ? '收款完成' : '切換收款'}</button><button className="btn btn-sm btn-ghost" style={{ fontSize:11 }} onClick={() => { setRefundOrder(o); setRefundAmount(''); setRefundNote('') }}><Undo2 size={10}/>退款</button>{Number(o.refund_amount || 0)>0 && <button className="btn btn-sm btn-ghost" style={{ fontSize:11 }} onClick={() => clearRefunds(o)}>清除退款</button>}</div>}</td>
        <td><span className={`badge ${supplierPay.status==='paid'?'badge-emerald':supplierPay.status==='partial'?'badge-amber':'badge-rose'}`}>{supplierPay.status==='paid'?'供應商已付款':supplierPay.status==='partial'?'供應商部分付款':'供應商未付款'}</span><div style={{fontSize:10,color:'var(--text-muted)',marginTop:4}}>已付 {money(supplierPay.paid)}／待付 {money(supplierPay.outstanding)}</div><div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>付款條件：{(()=>{const terms=[...new Set((o.items||[]).map(i=>i.supplier_payment_term||'manual'))];return terms.length===1?(PAYMENT_TERM_LABEL[terms[0]]||'手動付款'):'多種條件'})()}</div>{!archived && o.status !== 'cancelled' && <button className="btn btn-sm btn-ghost" style={{ marginTop:4,fontSize:11 }} onClick={() => { window.location.href='/supplier-payments' }}><WalletCards size={10}/>批次付款中心</button>}</td>
        <td style={{ color:'var(--text-secondary)',fontSize:13 }}>{o.order_date ? new Date(o.order_date).toLocaleDateString('zh-TW') : '—'}</td>
        <td style={{ textAlign:'right' }}><div style={{ display:'flex',gap:5,justifyContent:'flex-end',flexWrap:'wrap' }}><button className="btn-icon btn" title="出貨單" onClick={() => setReceiptOrders([o])}><Printer size={12}/></button>{!archived && o.status !== 'cancelled' && <button className="btn-icon btn" title="編輯" onClick={() => openEdit(o)}><Pencil size={12}/></button>}{!archived && o.status !== 'cancelled' && <button className="btn-icon btn" title="取消訂單" onClick={() => { setCancelOrder(o); setCancelReason('') }} style={{ color:'var(--rose)' }}><AlertCircle size={12}/></button>}{!archived && o.status === 'cancelled' && <button className="btn-icon btn" title="恢復訂單" onClick={() => restoreCancelled(o)}><RotateCcw size={12}/></button>}{!archived && <button className="btn-icon btn" title="封存" onClick={() => setConfirmArchive(o)}><Archive size={12}/></button>}<OrderDeleteButton order={o} onDeleted={load}/></div></td>
      </tr>})}
    </tbody></table></div>
      {!loading && filtered.length > renderLimit && <div style={{padding:12,textAlign:'center',borderTop:'1px solid var(--border)'}}><button className="btn btn-ghost" onClick={()=>setRenderLimit(v=>v+RENDER_PAGE_SIZE)}>顯示更多訂單（目前 {Math.min(renderLimit,filtered.length)}／{filtered.length}）</button></div>}
    </div>

    {showForm && <Modal title={editId ? '編輯訂單' : '開立新訂單'} onClose={() => setShowForm(false)} width={700}>
      <div className="form-group"><label>客戶 *</label><div className="dropdown" ref={custRef}><button type="button" className="btn btn-ghost" style={{ width:'100%',justifyContent:'space-between' }} onClick={() => setCustOpen(v => !v)}><span>{formCustomer ? `${formCustomer.name}${getCustomerPhoneLast2(formCustomer) ? `（末碼 ${getCustomerPhoneLast2(formCustomer)}）` : ''}` : '搜尋並選擇客戶...'}</span><ChevronDown size={14}/></button>{custOpen && <div className="dropdown-menu" style={{ width:'100%',maxHeight:320,overflowY:'auto' }}><div style={{ padding:8 }}><input autoFocus value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="姓名 / 手機末兩碼 / 完整電話 / Line / FB"/></div>{filtCusts.slice(0,50).map(c => <div key={c.id} className="dropdown-item" onClick={() => { setFormCustomer(c); setCustOpen(false) }}><div style={{ flex:1 }}><strong>{c.name}</strong><div style={{ fontSize:11,color:'var(--text-muted)',marginTop:2 }}>{customerSecondaryLabel(c) || '無其他辨識資料'}</div></div></div>)}</div>}</div></div>
      <div className="form-group"><label>加入商品</label><div className="dropdown" ref={prodRef}><button type="button" className="btn btn-ghost" style={{ width:'100%',justifyContent:'space-between' }} onClick={() => setProdOpen(v => !v)}><span>搜尋並加入商品（同商品可加入多次不同口味/規格）</span><ChevronDown size={14}/></button>{prodOpen && <div className="dropdown-menu" style={{ width:'100%' }}><div style={{ padding:8 }}><input autoFocus value={prodSearch} onChange={e => setProdSearch(e.target.value)} placeholder="商品名稱"/></div>{filtProds.slice(0,40).map(p => <div key={p.id} className="dropdown-item" onClick={() => addToCart(p)}><span style={{ flex:1 }}>{p.name}</span><strong style={{ color:'var(--indigo)' }}>NT${p.price}</strong></div>)}</div>}</div></div>
      {cartItems.map((item,idx) => { const price = itemPrice(item); return <div key={idx} style={{ borderBottom:'1px dashed var(--border)',padding:'10px 0' }}><div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' }}><strong style={{ flex:1,minWidth:140 }}>{item.product.name}</strong>{(item.product.price_options||[]).length>0&&<select value={item.price_option||''} onChange={e=>updateCart(idx,{price_option:e.target.value})} disabled={Boolean(item.snapshot)} style={{fontWeight:800,border:'1.5px solid var(--emerald)'}}><option value="">💰 選組合／包裝 *</option>{item.product.price_options.map(opt=><option key={opt.label} value={opt.label}>{opt.label}｜NT${Number(opt.price||0).toLocaleString()}</option>)}</select>}<button type="button" className="btn btn-sm btn-ghost" onClick={() => addSameProduct(idx)} title="再加入一筆相同商品"><Plus size={12}/>同商品</button><input value={item.note} onChange={e => updateCart(idx,{ note:e.target.value })} placeholder="備註" style={{ maxWidth:150 }}/><span>NT${Number(price).toLocaleString()}</span><QuantityInput value={item.qty} min={1} onChange={value => updateQty(idx,value)} ariaLabel={`${item.product.name}數量`} style={{ width:75 }}/><strong style={{ minWidth:90,textAlign:'right',color:'var(--indigo)' }}>NT${(Number(price)*Number(item.qty || 0)).toLocaleString()}</strong><button type="button" onClick={() => setCartItems(p => p.filter((_,i) => i !== idx))} style={{ border:'none',background:'none',color:'var(--rose)',cursor:'pointer' }}><X size={14}/></button></div><SpecSelector product={item.product} value={item.spec} onChange={spec => updateCart(idx,{ spec })}/>{item.snapshot && <div style={{ fontSize:10,color:'var(--text-muted)',marginTop:4 }}>歷史快照：售價 NT${Number(price).toLocaleString()}／成本 NT${Number(item.snapshot.cost_price ?? 0).toLocaleString()}／到貨 {arrivedQty(item.snapshot)}/{itemQty(item.snapshot)}</div>}</div> })}
      {cartItems.length > 0 && <div style={{ textAlign:'right',fontSize:18,fontWeight:900,color:'var(--indigo)',margin:'12px 0' }}>合計：NT${total.toLocaleString()}</div>}<label style={{display:'flex',alignItems:'flex-start',gap:10,padding:'12px 14px',marginBottom:12,border:'2px solid #fb7185',background:formVirtual?'#fff1f2':'#fff',borderRadius:10,cursor:'pointer'}}><input type="checkbox" checked={formVirtual} onChange={e=>setFormVirtual(e.target.checked)} style={{marginTop:3}}/><span><strong style={{color:'#be123c'}}>⚠ 設為虛擬訂單</strong><div style={{fontSize:11,color:'var(--text-secondary)',marginTop:3}}>客戶尚未完全確認；不計入實際訂貨量、供應商付款與正式財務報表。確定成交後可改回正式訂單。</div></span></label><div className="form-group"><label>訂單備註</label><input value={orderNote} onChange={e => setOrderNote(e.target.value)}/></div><div style={{ display:'flex',gap:10,justifyContent:'flex-end' }}><button className="btn btn-ghost" onClick={() => setShowForm(false)}>取消</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '處理中...' : '儲存訂單'}</button></div>
    </Modal>}

    {cancelOrder && <Modal title="取消訂單" onClose={() => setCancelOrder(null)} width={430}><div style={{ background:'var(--rose-light)',padding:10,borderRadius:8,marginBottom:14,fontSize:13 }}>取消後不會刪除資料，報表、營收、毛利都會自動排除此訂單。</div><div className="form-group"><label>取消原因</label><input value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="例如：客戶取消、缺貨"/></div><div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}><button className="btn btn-ghost" onClick={() => setCancelOrder(null)}>返回</button><button className="btn" style={{ background:'var(--rose)',color:'#fff' }} onClick={confirmCancel}>確認取消</button></div></Modal>}
    {refundOrder && <Modal title="新增退款紀錄" onClose={() => setRefundOrder(null)} width={430}><div style={{ background:'var(--amber-light)',padding:10,borderRadius:8,marginBottom:14,fontSize:13 }}>訂單原額 NT${Number(refundOrder.total_amount || 0).toLocaleString()}；已退款 NT${Number(refundOrder.refund_amount || 0).toLocaleString()}。</div><div className="form-group"><label>本次退款金額 *</label><input type="number" min="1" value={refundAmount} onChange={e => setRefundAmount(e.target.value)}/></div><div className="form-group"><label>退款原因 / 備註</label><input value={refundNote} onChange={e => setRefundNote(e.target.value)} placeholder="例如：缺貨退款"/></div><div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}><button className="btn btn-ghost" onClick={() => setRefundOrder(null)}>取消</button><button className="btn btn-primary" onClick={applyRefund}><DollarSign size={13}/>記錄退款</button></div></Modal>}
    {receiptOrders && <GroupedReceipt orders={receiptOrders} onClose={() => setReceiptOrders(null)}/>} 
    {confirmArchive && <ConfirmDialog message={`確定要封存「${confirmArchive.customer_name}」的訂單？\n封存不會刪除帳務與歷史資料。`} onConfirm={() => archiveOrder(confirmArchive)} onCancel={() => setConfirmArchive(null)}/>} 
  </div>
}
