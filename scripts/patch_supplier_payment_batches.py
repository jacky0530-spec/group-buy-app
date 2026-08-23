from pathlib import Path

def rep(s, old, new, label):
    if old not in s:
        raise SystemExit(f'{label} not found')
    return s.replace(old,new,1)

# db.js
p=Path('src/lib/db.js'); s=p.read_text()
s=rep(s,"    supplier_payment_term: product.supplier_payment_term || 'manual',\n    qty: quantity,","    supplier_payment_term: product.supplier_payment_term || 'manual',\n    supplier_paid_amount: 0,\n    supplier_payment_status: 'unpaid',\n    supplier_payment_refs: [],\n    qty: quantity,",'snapshot payment fields')
insert="""

export const SupplierPaymentsAPI = {
  async list() {
    const snap = await getDocs(query(collection(db,'supplier_payments'), orderBy('created_at','desc')))
    return snap.docs.map(normalize)
  },
  async createPayment({ supplier, payment_date, amount, note = '', lines = [] }) {
    const cleanSupplier = String(supplier || '').trim()
    const totalAmount = Number(amount || 0)
    if (!cleanSupplier) throw new Error('請選擇供應商')
    if (!(totalAmount > 0)) throw new Error('付款金額必須大於 0')
    if (!Array.isArray(lines) || !lines.length) throw new Error('請選擇付款明細')

    let remaining = totalAmount
    const allocations = []
    for (const line of lines) {
      if (remaining <= 0.0001) break
      const outstanding = Math.max(0, Number(line.outstanding || 0))
      if (!(outstanding > 0)) continue
      const allocated = Math.min(outstanding, remaining)
      allocations.push({
        order_id:line.order_id,
        item_index:Number(line.item_index),
        customer_name:line.customer_name || '',
        product_name:line.product_name || '',
        supplier:cleanSupplier,
        amount:allocated,
      })
      remaining -= allocated
    }
    if (!allocations.length || remaining > 0.01) throw new Error('付款金額超過可分配的待付款金額')

    const paymentRef = doc(collection(db,'supplier_payments'))
    const byOrder = new Map()
    allocations.forEach(a => {
      if (!byOrder.has(a.order_id)) byOrder.set(a.order_id,[])
      byOrder.get(a.order_id).push(a)
    })
    if (byOrder.size > 450) throw new Error('單次付款涵蓋訂單過多，請分批處理')

    const batch = writeBatch(db)
    for (const [orderId,orderAllocations] of byOrder.entries()) {
      const ref = doc(db,'orders',orderId)
      const snap = await getDoc(ref)
      if (!snap.exists()) throw new Error(`找不到訂單 ${orderId}`)
      const items = [...(snap.data().items || [])]
      orderAllocations.forEach(a => {
        const item = { ...(items[a.item_index] || {}) }
        const costTotal = Number(item.cost_price || 0) * Number(item.qty || 0)
        const oldPaid = Math.max(0, Number(item.supplier_paid_amount || 0))
        const nextPaid = Math.min(costTotal, oldPaid + Number(a.amount || 0))
        item.supplier_paid_amount = nextPaid
        item.supplier_payment_status = nextPaid >= costTotal - 0.01 ? 'paid' : nextPaid > 0 ? 'partial' : 'unpaid'
        item.supplier_payment_refs = [...new Set([...(item.supplier_payment_refs || []),paymentRef.id])]
        item.supplier_paid_at = payment_date || nowISO().slice(0,10)
        items[a.item_index] = item
      })
      batch.update(ref,{ items, updated_at:now() })
    }
    batch.set(paymentRef,{
      supplier:cleanSupplier,
      payment_date:payment_date || nowISO().slice(0,10),
      amount:totalAmount,
      note:String(note || '').trim(),
      allocations,
      created_at:now(),
      updated_at:now(),
    })
    await batch.commit()
    return { id:paymentRef.id, amount:totalAmount, allocation_count:allocations.length }
  },
}
"""
marker="\nexport const CustomersAPI = {"
s=rep(s,marker,insert+marker,'insert SupplierPaymentsAPI')
p.write_text(s)

# App.jsx
p=Path('src/App.jsx'); s=p.read_text()
s=rep(s,"import Expenses from './pages/Expenses'","import Expenses from './pages/Expenses'\nimport SupplierPayments from './pages/SupplierPayments'",'App import')
s=rep(s,"                <Route path=\"expenses\" element={<Expenses />} />","                <Route path=\"expenses\" element={<Expenses />} />\n                <Route path=\"supplier-payments\" element={<SupplierPayments />} />",'App route')
p.write_text(s)

# Layout.jsx
p=Path('src/components/Layout.jsx'); s=p.read_text()
s=rep(s,"import { ShoppingBag, Users, ShoppingCart, BarChart2, Home, Menu, X, UserCog, ClipboardList, ReceiptText } from 'lucide-react'","import { ShoppingBag, Users, ShoppingCart, BarChart2, Home, Menu, X, UserCog, ClipboardList, ReceiptText, CreditCard } from 'lucide-react'",'Layout icon')
s=rep(s,"const APP_VERSION = 'v2026.08.23.7'","const APP_VERSION = 'v2026.08.23.8'",'version')
s=rep(s,"  { to: '/expenses', icon: ReceiptText, label: '其他費用' },","  { to: '/expenses', icon: ReceiptText, label: '其他費用' },\n  { to: '/supplier-payments', icon: CreditCard, label: '供應商付款' },",'Layout nav')
p.write_text(s)

# Orders.jsx
p=Path('src/pages/Orders.jsx'); s=p.read_text()
helper="""
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
"""
s=rep(s,"function specLabel(item) {",helper+"\nfunction specLabel(item) {",'Orders helper')
s=s.replace("  async function togglePayable(o) { try { const next = o.payable_status === 'paid' ? 'unpaid' : 'paid'; await OrdersAPI.updatePayable(o.id,next); toast(next === 'paid' ? '✅ 已標記供應商付款' : '↩️ 已恢復供應商未付款'); await load() } catch (err) { toast('更新失敗：'+err.message,'error') } }\n","")
s=rep(s,"const acfg = PAYABLE_CFG[o.payable_status] || PAYABLE_CFG.unpaid; const archived", "const supplierPay = supplierPaymentSummary(o); const archived",'Orders row payable cfg')
old="<td><span className={`badge ${acfg.badge}`}>{acfg.label}</span><div style={{fontSize:10,color:'var(--text-muted)',marginTop:4}}>付款條件：{(()=>{const terms=[...new Set((o.items||[]).map(i=>i.supplier_payment_term||'manual'))];return terms.length===1?(PAYMENT_TERM_LABEL[terms[0]]||'手動付款'):'多種條件'})()}</div>{o.payable_status==='paid'&&o.payable_paid_at&&<div style={{fontSize:10,color:'var(--emerald)',marginTop:2}}>付款日：{new Date(o.payable_paid_at).toLocaleDateString('zh-TW')}</div>}{!archived && o.status !== 'cancelled' && <button className=\"btn btn-sm btn-ghost\" style={{ marginTop:4,fontSize:11 }} onClick={() => togglePayable(o)}><WalletCards size={10}/>{o.payable_status === 'paid' ? '取消付款' : '付款完成'}</button>}</td>"
new="<td><span className={`badge ${supplierPay.status==='paid'?'badge-emerald':supplierPay.status==='partial'?'badge-amber':'badge-rose'}`}>{supplierPay.status==='paid'?'供應商已付款':supplierPay.status==='partial'?'供應商部分付款':'供應商未付款'}</span><div style={{fontSize:10,color:'var(--text-muted)',marginTop:4}}>已付 {money(supplierPay.paid)}／待付 {money(supplierPay.outstanding)}</div><div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>付款條件：{(()=>{const terms=[...new Set((o.items||[]).map(i=>i.supplier_payment_term||'manual'))];return terms.length===1?(PAYMENT_TERM_LABEL[terms[0]]||'手動付款'):'多種條件'})()}</div>{!archived && o.status !== 'cancelled' && <button className=\"btn btn-sm btn-ghost\" style={{ marginTop:4,fontSize:11 }} onClick={() => { window.location.href='/supplier-payments' }}><WalletCards size={10}/>批次付款中心</button>}</td>"
s=rep(s,old,new,'Orders payable cell')
s=s.replace("const PAYABLE_CFG = { unpaid:{ label:'供應商未付款',badge:'badge-amber' }, paid:{ label:'供應商已付款',badge:'badge-emerald' } }\n","")
# Add local money helper if missing
if "const money = value =>" not in s:
    s=rep(s,"const PAYMENT_TERM_LABEL =", "const money = value => `NT$${Math.round(Number(value || 0)).toLocaleString()}`\nconst PAYMENT_TERM_LABEL =",'Orders money helper')
p.write_text(s)

# Reports.jsx
p=Path('src/pages/Reports.jsx'); s=p.read_text()
s=rep(s,"import { OrdersAPI, ProductsAPI, effectiveOrderAmount, orderSnapshotCost } from '../lib/db'","import { OrdersAPI, ProductsAPI, SupplierPaymentsAPI, effectiveOrderAmount, orderSnapshotCost } from '../lib/db'",'Reports import')
s=rep(s,"const[orders,setOrders]=useState([]),[products,setProducts]=useState([]),[expenses,setExpenses]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('')","const[orders,setOrders]=useState([]),[products,setProducts]=useState([]),[expenses,setExpenses]=useState([]),[supplierPayments,setSupplierPayments]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('')",'Reports state')
s=rep(s,"const loadBase=useCallback(async()=>{try{const[p,e]=await Promise.all([ProductsAPI.list({includeArchived:true}),ExpensesAPI.list()]);setProducts(p);setExpenses(e)}catch(err)","const loadBase=useCallback(async()=>{try{const[p,e,sp]=await Promise.all([ProductsAPI.list({includeArchived:true}),ExpensesAPI.list(),SupplierPaymentsAPI.list()]);setProducts(p);setExpenses(e);setSupplierPayments(sp)}catch(err)",'Reports load payments')
period_helper="""
  const paymentInPeriod = row => { if(filterMode==='all') return true; const d=String(row.payment_date||''); if(filterMode==='month') return d.startsWith(inputMonth); if(filterMode==='range') return Boolean(inputStart&&inputEnd&&d>=inputStart&&d<=inputEnd); return false }
  const periodSupplierPayments=supplierPayments.filter(paymentInPeriod),supplierPaidThisPeriod=periodSupplierPayments.reduce((s,p)=>s+Number(p.amount||0),0)
"""
s=rep(s,"  const currentCostMap=",period_helper+"  const currentCostMap=",'Reports payment period')
old="supplierPaidCost=validOrders.filter(o=>o.payable_status==='paid').reduce((s,o)=>s+orderSnapshotCost(o,currentCostMap),0),payableOutstanding=validOrders.filter(o=>o.payable_status!=='paid').reduce((s,o)=>s+orderSnapshotCost(o,currentCostMap),0),paidNotArrived=validOrders.filter(o=>o.payable_status==='paid'&&(o.items||[]).some(i=>Number(i.arrived_qty||0)<Number(i.qty||0))).reduce((s,o)=>s+orderSnapshotCost(o,currentCostMap),0),arrivedNotPaid=validOrders.filter(o=>o.payable_status!=='paid'&&(o.items||[]).length>0&&(o.items||[]).every(i=>Number(i.arrived_qty||0)>=Number(i.qty||0))).reduce((s,o)=>s+orderSnapshotCost(o,currentCostMap),0),netCashFlow=collectedAmount-supplierPaidCost-expenseNet"
new="supplierPaidCost=validOrders.reduce((sum,o)=>sum+(o.items||[]).reduce((s,i)=>s+Math.max(0,Number(i.supplier_paid_amount||0)),0),0),payableOutstanding=validOrders.reduce((sum,o)=>sum+(o.items||[]).reduce((s,i)=>s+Math.max(0,Number(i.cost_price||0)*Number(i.qty||0)-Number(i.supplier_paid_amount||0)),0),0),paidNotArrived=validOrders.reduce((sum,o)=>sum+(o.items||[]).reduce((s,i)=>s+((Number(i.supplier_paid_amount||0)>0&&Number(i.arrived_qty||0)<Number(i.qty||0))?Number(i.supplier_paid_amount||0):0),0),0),arrivedNotPaid=validOrders.reduce((sum,o)=>sum+(o.items||[]).reduce((s,i)=>{const due=Math.max(0,Number(i.cost_price||0)*Number(i.qty||0)-Number(i.supplier_paid_amount||0));return s+(Number(i.qty||0)>0&&Number(i.arrived_qty||0)>=Number(i.qty||0)?due:0)},0),0),netCashFlow=collectedAmount-supplierPaidThisPeriod-expenseNet"
s=rep(s,old,new,'Reports finance metrics')
s=s.replace("['已付供應商商品成本',supplierPaidCost,false]","['本期實際供應商付款',supplierPaidThisPeriod,false]")
s=s.replace("💡 供應商付款與到貨是兩條獨立流程：付款完成代表錢已實際匯出；到貨只代表商品收到。","💡 供應商付款採批次紀錄：現金流依「實際匯款日期」計入；到貨只代表商品收到。")
p.write_text(s)

# SupplierPayments responsive grid
p=Path('src/pages/SupplierPayments.jsx'); s=p.read_text().replace("gridTemplateColumns:'minmax(240px,320px) minmax(0,1fr)'","gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))'")
p.write_text(s)
