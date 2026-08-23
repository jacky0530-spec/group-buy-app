from pathlib import Path


def rep(s, old, new, label):
    if old not in s:
        raise SystemExit(f'{label} not found')
    return s.replace(old, new, 1)

# db.js
p=Path('src/lib/db.js'); s=p.read_text()
s=rep(s,
"    return snap.docs.map(normalize)\n  },\n  async createPayment({ supplier, payment_date, amount, note = '', lines = [] }) {",
"    return snap.docs.map(normalize).filter(row => row.voided !== true)\n  },\n  async createPayment({ supplier, payment_date, amount, note = '', lines = [] }) {",
'filter voided supplier payments')
insert="""
  async bulkHardDelete(ids = []) {
    const targetIds = [...new Set((ids || []).filter(Boolean))]
    if (!targetIds.length) return { deleted:0, adjusted_payments:0, voided_payments:0 }
    const targetSet = new Set(targetIds)
    const paymentsSnap = await getDocs(collection(db,'supplier_payments'))
    const paymentOps = []
    let adjustedPayments = 0
    let voidedPayments = 0

    paymentsSnap.docs.forEach(paymentDoc => {
      const data = paymentDoc.data()
      if (data.voided === true) return
      const allocations = Array.isArray(data.allocations) ? data.allocations : []
      const removed = allocations.filter(a => targetSet.has(a.order_id))
      if (!removed.length) return
      const kept = allocations.filter(a => !targetSet.has(a.order_id))
      const removedAmount = removed.reduce((sum,a) => sum + Number(a.amount || 0),0)
      const nextAmount = Math.max(0,Number(data.amount || 0) - removedAmount)
      const voided = kept.length === 0 || nextAmount <= 0.001
      paymentOps.push({
        type:'update',
        ref:paymentDoc.ref,
        data:{
          allocations:kept,
          amount:voided ? 0 : nextAmount,
          voided,
          voided_at:voided ? now() : null,
          void_reason:voided ? '相關測試訂單已永久刪除' : '',
          updated_at:now(),
        },
      })
      adjustedPayments += 1
      if (voided) voidedPayments += 1
    })

    const operations = [
      ...paymentOps,
      ...targetIds.map(id => ({ type:'delete', ref:doc(db,'orders',id) })),
    ]
    for (let i=0; i<operations.length; i+=400) {
      const batch = writeBatch(db)
      operations.slice(i,i+400).forEach(op => {
        if (op.type === 'delete') batch.delete(op.ref)
        else batch.update(op.ref,op.data)
      })
      await batch.commit()
    }
    return { deleted:targetIds.length, adjusted_payments:adjustedPayments, voided_payments:voidedPayments }
  },
"""
s=rep(s,"  async batchUpdateStatus(ids, status) {",insert+"  async batchUpdateStatus(ids, status) {",'insert bulk hard delete')
p.write_text(s)

# OrderDeleteButton.jsx use shared cleanup API
p=Path('src/components/OrderDeleteButton.jsx'); s=p.read_text()
s=rep(s,"import { deleteDoc, doc } from 'firebase/firestore'\nimport { db } from '../lib/firebase'\n", "import { OrdersAPI } from '../lib/db'\n", 'single delete imports')
s=rep(s,"      await deleteDoc(doc(db, 'orders', order.id))", "      await OrdersAPI.bulkHardDelete([order.id])", 'single delete api')
p.write_text(s)

# Orders.jsx
p=Path('src/pages/Orders.jsx'); s=p.read_text()
s=rep(s,"import { Plus, Pencil, Archive, Search, ChevronDown, X, Printer, CheckCircle, Clock, AlertCircle, RotateCcw, DollarSign, Undo2, WalletCards, PackageCheck } from 'lucide-react'",
"import { Plus, Pencil, Archive, Search, ChevronDown, X, Printer, CheckCircle, Clock, AlertCircle, RotateCcw, DollarSign, Undo2, WalletCards, PackageCheck, Trash2 } from 'lucide-react'",'trash icon')
s=rep(s,
"  const [search,setSearch] = useState(''); const [filterStatus,setFilterStatus] = useState('all'); const [filterPayment,setFilterPayment] = useState('all'); const [showArchived,setShowArchived] = useState(false); const [selected,setSelected] = useState([])",
"  const [search,setSearch] = useState(''); const [filterStatus,setFilterStatus] = useState('all'); const [filterPayment,setFilterPayment] = useState('all'); const [filterProduct,setFilterProduct] = useState('all'); const [filterDateFrom,setFilterDateFrom] = useState(''); const [filterDateTo,setFilterDateTo] = useState(''); const [showArchived,setShowArchived] = useState(false); const [selected,setSelected] = useState([])",
'filter states')
old="  const filtered = visibleOrders.filter(o => { const q = search.toLowerCase().trim(); const ms = (o.customer_name || '').toLowerCase().includes(q) || orderPhoneLast2(o).toLowerCase().includes(q) || String(o.customer_phone || customerMap[o.customer_id]?.phone || '').includes(search.trim()) || (o.items || []).some(i => (i.product_name || i.name || '').toLowerCase().includes(q)); return ms && (filterStatus === 'all' || o.status === filterStatus) && (filterPayment === 'all' || o.payment_status === filterPayment) })"
new="  const filtered = visibleOrders.filter(o => { const q = search.toLowerCase().trim(); const ms = (o.customer_name || '').toLowerCase().includes(q) || orderPhoneLast2(o).toLowerCase().includes(q) || String(o.customer_phone || customerMap[o.customer_id]?.phone || '').includes(search.trim()) || (o.items || []).some(i => (i.product_name || i.name || '').toLowerCase().includes(q)); const productMatch = filterProduct === 'all' || (o.items || []).some(i => (i.product_id || i.id) === filterProduct); const orderDay = String(o.order_date || '').slice(0,10); const dateMatch = (!filterDateFrom || orderDay >= filterDateFrom) && (!filterDateTo || orderDay <= filterDateTo); return ms && productMatch && dateMatch && (filterStatus === 'all' || o.status === filterStatus) && (filterPayment === 'all' || o.payment_status === filterPayment) })"
s=rep(s,old,new,'filtered logic')
s=rep(s,
"  const filtProds = products.filter(p => p.name.toLowerCase().includes(prodSearch.toLowerCase()))",
"  const filtProds = products.filter(p => p.name.toLowerCase().includes(prodSearch.toLowerCase()))\n  const sortedFilterProducts = [...products].sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''),'zh-Hant'))\n  const hasOrderFilters = filterProduct !== 'all' || filterDateFrom || filterDateTo",
'filter product options')
s=rep(s,
"  useEffect(() => { load() },[load])",
"  useEffect(() => { load() },[load])\n  useEffect(() => { setSelected([]) },[search,filterStatus,filterPayment,filterProduct,filterDateFrom,filterDateTo,showArchived])",
'clear selection on filters')
insert_fn="""
  async function bulkDeleteSelected() {
    const targets = filtered.filter(o => selected.includes(o.id) && !o.archived && o.status !== 'cancelled')
    if (!targets.length) { toast('目前沒有可永久刪除的已選訂單','warning'); return }
    const productText = filterProduct === 'all' ? '全部商品' : (products.find(p => p.id === filterProduct)?.name || '指定商品')
    const dateText = filterDateFrom || filterDateTo ? `${filterDateFrom || '最早'} ～ ${filterDateTo || '今天'}` : '全部日期'
    const first = window.confirm(`確定要永久刪除目前選取的 ${targets.length} 筆訂單？\\n\\n商品條件：${productText}\\n日期條件：${dateText}\\n\\n刪除後無法復原。`)
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
"""
s=rep(s,"  async function batchShip() {",insert_fn+"  async function batchShip() {",'bulk delete function')
old_toolbar="<button className=\"btn btn-ghost btn-sm\" onClick={() => setReceiptOrders(filtered.filter(o => selected.includes(o.id)))}><Printer size={13}/>出貨單</button></>}<button className=\"btn btn-primary\" onClick={openAdd}><Plus size={15}/>開立訂單</button>"
new_toolbar="<button className=\"btn btn-ghost btn-sm\" onClick={() => setReceiptOrders(filtered.filter(o => selected.includes(o.id)))}><Printer size={13}/>出貨單</button><button className=\"btn btn-sm\" onClick={bulkDeleteSelected} style={{background:'var(--rose)',color:'white',borderColor:'var(--rose)'}} title=\"永久刪除目前篩選後已選取的訂單\"><Trash2 size={13}/>一鍵刪除 {selected.length}</button></>}<button className=\"btn btn-primary\" onClick={openAdd}><Plus size={15}/>開立訂單</button>"
s=rep(s,old_toolbar,new_toolbar,'bulk delete toolbar')
old_filters="<div style={{ display:'flex',gap:8,marginBottom:14,flexWrap:'wrap' }}><div className=\"search-input-wrap\" style={{ flex:1,minWidth:220 }}><Search size={14}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder=\"搜尋客戶、手機末兩碼或商品...\" style={{ padding:'8px 8px 8px 32px',width:'100%' }}/></div><select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value=\"all\">全部出貨狀態</option><option value=\"pending\">待出貨</option><option value=\"shipped\">已出貨</option><option value=\"cancelled\">已取消</option></select><select value={filterPayment} onChange={e => setFilterPayment(e.target.value)}><option value=\"all\">全部收款狀態</option><option value=\"unpaid\">未收款</option><option value=\"paid\">已收款</option><option value=\"partial_refund\">部分退款</option><option value=\"refunded\">已全額退款</option></select></div>"
new_filters="<div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:12,marginBottom:14}}><div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}><div className=\"search-input-wrap\" style={{ flex:'1 1 260px',minWidth:220 }}><Search size={14}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder=\"搜尋客戶、手機末兩碼或商品...\" style={{ padding:'8px 8px 8px 32px',width:'100%' }}/></div><select value={filterProduct} onChange={e => setFilterProduct(e.target.value)} style={{minWidth:180}}><option value=\"all\">📦 全部商品</option>{sortedFilterProducts.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><label style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--text-secondary)'}}>起日<input type=\"date\" value={filterDateFrom} onChange={e=>setFilterDateFrom(e.target.value)} /></label><label style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--text-secondary)'}}>迄日<input type=\"date\" value={filterDateTo} onChange={e=>setFilterDateTo(e.target.value)} /></label><select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value=\"all\">全部出貨狀態</option><option value=\"pending\">待出貨</option><option value=\"shipped\">已出貨</option><option value=\"cancelled\">已取消</option></select><select value={filterPayment} onChange={e => setFilterPayment(e.target.value)}><option value=\"all\">全部收款狀態</option><option value=\"unpaid\">未收款</option><option value=\"paid\">已收款</option><option value=\"partial_refund\">部分退款</option><option value=\"refunded\">已全額退款</option></select>{hasOrderFilters&&<button className=\"btn btn-sm btn-ghost\" onClick={()=>{setFilterProduct('all');setFilterDateFrom('');setFilterDateTo('')}}><RotateCcw size={12}/>清除商品／日期</button>}</div><div style={{fontSize:11,color:'var(--text-muted)',marginTop:8}}>目前篩選結果 <strong>{filtered.length}</strong> 筆。表頭全選只會勾選目前篩選後可操作的訂單；選取後可一鍵永久刪除。</div></div>"
s=rep(s,old_filters,new_filters,'filter controls')
p.write_text(s)

# Layout version
p=Path('src/components/Layout.jsx'); s=p.read_text(); s=rep(s,"const APP_VERSION = 'v2026.08.23.9'","const APP_VERSION = 'v2026.08.23.10'",'version'); p.write_text(s)
