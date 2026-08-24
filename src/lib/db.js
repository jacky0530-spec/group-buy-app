import {
  collection, doc,
  getDocs, getDoc, addDoc, updateDoc,
  query, orderBy, where, Timestamp,
  writeBatch, arrayUnion, limit, startAfter, setDoc,
} from 'firebase/firestore'
import { db } from './firebase'
import { derivePhoneLast2, getCustomerPhoneLast2, normalizePhoneLast2 } from './customerSearch'

function tsToISO(val) {
  if (!val) return null
  if (val instanceof Timestamp) return val.toDate().toISOString()
  if (val?.seconds) return new Timestamp(val.seconds, val.nanoseconds).toDate().toISOString()
  return val
}

function normalize(docSnap) {
  const d = { id: docSnap.id, ...docSnap.data() }
  const timeFields = [
    'created_at','updated_at','joined_at','order_date','shipped_at',
    'cancelled_at','refunded_at','archived_at','payable_paid_at',
  ]
  timeFields.forEach(f => { if (d[f]) d[f] = tsToISO(d[f]) })
  return d
}

const now = () => Timestamp.now()
const nowISO = () => new Date().toISOString()
const activeOnly = rows => rows.filter(x => x.active !== false)
const normalizeNameKey = value => String(value || '').trim().toLocaleLowerCase('zh-TW')

function customerPayload(data) {
  const phone = String(data.phone || '').trim()
  const manualLast2 = normalizePhoneLast2(data.phone_last2)
  return {
    ...data,
    phone,
    phone_last2: manualLast2 || derivePhoneLast2(phone),
  }
}

function mergedNote(current, incoming) {
  const oldText = String(current || '').trim()
  const newText = String(incoming || '').trim()
  if (!newText) return oldText
  if (!oldText) return newText
  if (oldText.includes(newText)) return oldText
  return `${oldText}；${newText}`
}

export function snapshotOrderItem(product, { qty = 1, note = '', spec = {}, priceOption = null } = {}) {
  const price = Number(priceOption?.price ?? product.price ?? 0)
  const cost = Number(priceOption?.cost === '' || priceOption?.cost == null ? (product.cost || 0) : priceOption.cost)
  const quantity = Math.max(1, Number(qty || 1))
  return {
    id: product.id,
    product_id: product.id,
    name: product.name,
    product_name: product.name,
    price,
    sale_price: price,
    cost_price: cost,
    category: product.category || 'other',
    supplier: product.supplier || '',
    supplier_payment_term: product.supplier_payment_term || 'manual',
    supplier_paid_amount: 0,
    supplier_payment_status: 'unpaid',
    supplier_payment_refs: [],
    qty: quantity,
    subtotal: price * quantity,
    cost_subtotal: cost * quantity,
    note: note || '',
    spec: {
      color: spec?.color || '',
      size: spec?.size || '',
      flavor: spec?.flavor || '',
      package: priceOption?.label || spec?.package || '',
    },
  }
}

export function effectiveOrderAmount(order) {
  if (!order || order.status === 'cancelled') return 0
  return Math.max(0, Number(order.total_amount || 0) - Number(order.refund_amount || 0))
}

export function orderSnapshotCost(order, currentCostMap = {}) {
  if (!order || order.status === 'cancelled') return 0
  return (order.items || []).reduce((sum, item) => {
    const qty = Number(item.qty || 0)
    const snapCost = item.cost_price
    const fallback = currentCostMap[item.product_id || item.id] || 0
    return sum + Number(snapCost ?? fallback) * qty
  }, 0)
}


function helperCatalogPayload(product) {
  return {
    name:String(product?.name || '').trim(),
    price:Number(product?.price || 0),
    category:product?.category || 'other',
    pricing_mode:product?.pricing_mode || ((product?.price_options || []).length ? 'options' : 'single'),
    spec_mode:product?.spec_mode || 'none',
    spec_colors:[...(product?.spec_colors || [])],
    spec_sizes:[...(product?.spec_sizes || [])],
    spec_flavors:[...(product?.spec_flavors || [])],
    price_options:(product?.price_options || []).map(o => ({ label:String(o.label || ''), price:Number(o.price || 0) })),
    active:product?.active !== false,
    updated_at:now(),
  }
}

export const ProductsAPI = {
  async list({ includeArchived = false } = {}) {
    const snap = await getDocs(query(collection(db,'products'), orderBy('created_at','desc')))
    const rows = snap.docs.map(normalize)
    return includeArchived ? rows : activeOnly(rows)
  },
  async create(data) {
    const payload = { ...data, active:true, created_at:now(), updated_at:now() }
    const ref = await addDoc(collection(db,'products'), payload)
    await setDoc(doc(db,'helper_catalog',ref.id), helperCatalogPayload({ ...data,active:true }))
    return { id:ref.id, ...data, active:true, created_at:nowISO(), updated_at:nowISO() }
  },
  async update(id, data) {
    await updateDoc(doc(db,'products',id), { ...data, updated_at:now() })
    await setDoc(doc(db,'helper_catalog',id), helperCatalogPayload(data), { merge:true })
  },
  async archive(id) {
    await updateDoc(doc(db,'products',id), { active:false, archived_at:now(), updated_at:now() })
    await setDoc(doc(db,'helper_catalog',id), { active:false,updated_at:now() }, { merge:true })
  },
  async restore(id) {
    await updateDoc(doc(db,'products',id), { active:true, archived_at:null, updated_at:now() })
    await setDoc(doc(db,'helper_catalog',id), { active:true,updated_at:now() }, { merge:true })
  },
  async isDuplicate(name, excludeId = null) {
    const snap = await getDocs(query(collection(db,'products'), where('name','==',name)))
    return snap.docs.some(d => d.id !== excludeId && d.data().active !== false)
  },
}


export const SupplierPaymentsAPI = {
  async list() {
    const snap = await getDocs(query(collection(db,'supplier_payments'), orderBy('created_at','desc')))
    return snap.docs.map(normalize).filter(row => row.voided !== true)
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

export const CustomersAPI = {
  async list({ includeArchived = false } = {}) {
    const snap = await getDocs(query(collection(db,'customers'), orderBy('joined_at','desc')))
    const rows = snap.docs.map(normalize)
    return includeArchived ? rows : activeOnly(rows)
  },
  async create(data) {
    const clean = customerPayload(data)
    const payload = { ...clean, active:true, joined_at:now(), updated_at:now() }
    const ref = await addDoc(collection(db,'customers'), payload)
    return { id:ref.id, ...clean, active:true, joined_at:nowISO() }
  },
  async update(id, data) {
    const clean = customerPayload(data)
    await updateDoc(doc(db,'customers',id), { ...clean, updated_at:now() })
  },
  async archive(id) {
    await updateDoc(doc(db,'customers',id), { active:false, archived_at:now(), updated_at:now() })
  },
  async restore(id) {
    await updateDoc(doc(db,'customers',id), { active:true, archived_at:null, updated_at:now() })
  },
  async isDuplicateIdentity({ phone = '', line_nick = '', fb_name = '' }, excludeId = null) {
    const checks = [['phone',phone.trim()],['line_nick',line_nick.trim()],['fb_name',fb_name.trim()]].filter(([,v]) => v)
    for (const [field,value] of checks) {
      const snap = await getDocs(query(collection(db,'customers'), where(field,'==',value)))
      if (snap.docs.some(d => d.id !== excludeId && d.data().active !== false)) return { duplicate:true, field, value }
    }
    return { duplicate:false }
  },
  async importRows(rows = []) {
    if (!Array.isArray(rows)) throw new Error('匯入格式不正確')
    const snap = await getDocs(collection(db,'customers'))
    const local = snap.docs.map(normalize)
    const operations = []
    let created = 0, updated = 0, skipped = 0, ambiguous = 0

    const scheduleUpdate = (customer, patch) => {
      operations.push({ type:'update', ref:doc(db,'customers',customer.id), data:{ ...patch, updated_at:now() } })
      Object.assign(customer,patch)
      updated += 1
    }

    for (const input of rows) {
      const name = String(input?.name || '').trim()
      if (!name) { skipped += 1; continue }
      const phone = String(input?.phone || '').trim()
      const phoneLast2 = normalizePhoneLast2(input?.phone_last2) || derivePhoneLast2(phone)
      const note = String(input?.note || '').trim()
      const key = normalizeNameKey(name)
      const sameName = local.filter(c => c.active !== false && normalizeNameKey(c.name) === key)
      const exact = sameName.find(c => {
        const existingLast2 = getCustomerPhoneLast2(c)
        return phoneLast2 ? existingLast2 === phoneLast2 : !existingLast2
      })

      if (exact) {
        const patch = {}
        if (phoneLast2 && !normalizePhoneLast2(exact.phone_last2)) patch.phone_last2 = phoneLast2
        if (phone && !exact.phone) patch.phone = phone
        const nextNote = mergedNote(exact.note,note)
        if (nextNote !== String(exact.note || '').trim()) patch.note = nextNote
        if (Object.keys(patch).length) scheduleUpdate(exact,patch)
        else skipped += 1
        continue
      }

      const untagged = sameName.filter(c => !getCustomerPhoneLast2(c) && !c.phone)
      if (phoneLast2 && sameName.length === 1 && untagged.length === 1) {
        const target = untagged[0]
        const patch = { phone_last2:phoneLast2 }
        if (phone) patch.phone = phone
        const nextNote = mergedNote(target.note,note)
        if (nextNote !== String(target.note || '').trim()) patch.note = nextNote
        scheduleUpdate(target,patch)
        continue
      }

      if (phoneLast2 && sameName.length > 1 && untagged.length > 0) ambiguous += 1
      const ref = doc(collection(db,'customers'))
      const payload = {
        name,
        line_nick:String(input?.line_nick || '').trim(),
        fb_name:String(input?.fb_name || '').trim(),
        phone,
        phone_last2:phoneLast2,
        note,
        active:true,
        import_source:String(input?.import_source || 'customer-json-v1'),
        joined_at:now(),
        updated_at:now(),
      }
      operations.push({ type:'set', ref, data:payload })
      local.push({ id:ref.id, ...payload })
      created += 1
    }

    for (let i=0; i<operations.length; i+=400) {
      const batch = writeBatch(db)
      operations.slice(i,i+400).forEach(op => {
        if (op.type === 'set') batch.set(op.ref,op.data)
        else batch.update(op.ref,op.data)
      })
      await batch.commit()
    }
    return { scanned:rows.length, created, updated, skipped, ambiguous }
  },
}

export const OrdersAPI = {
  async list() {
    const snap = await getDocs(query(collection(db,'orders'), orderBy('order_date','desc')))
    return snap.docs.map(normalize)
  },
  async listByDateRange(startISO, endISO) {
    const clauses = [orderBy('order_date','desc')]
    if (startISO) clauses.unshift(where('order_date','>=', Timestamp.fromDate(new Date(startISO))))
    if (endISO) clauses.unshift(where('order_date','<=', Timestamp.fromDate(new Date(endISO))))
    const snap = await getDocs(query(collection(db,'orders'), ...clauses))
    return snap.docs.map(normalize)
  },
  async listPage({ pageSize = 100, cursor = null } = {}) {
    const clauses = [orderBy('order_date','desc'), limit(pageSize)]
    if (cursor) clauses.splice(1,0,startAfter(cursor))
    const snap = await getDocs(query(collection(db,'orders'), ...clauses))
    return {
      rows:snap.docs.map(normalize),
      nextCursor:snap.docs.length ? snap.docs[snap.docs.length-1] : null,
      hasMore:snap.docs.length === pageSize,
    }
  },
  async create(data) {
    const payload = {
      ...data,
      status:data.status || 'pending',
      payment_status:data.payment_status || 'unpaid',
      payable_status:data.payable_status || 'unpaid',
      refund_amount:Number(data.refund_amount || 0),
      refunds:data.refunds || [],
      status_history:data.status_history || [{ status:data.status || 'pending', at:nowISO(), note:'建立訂單' }],
      order_date:now(), created_at:now(), updated_at:now(),
    }
    const ref = await addDoc(collection(db,'orders'), payload)
    return { id:ref.id, ...data, ...payload, order_date:nowISO(), created_at:nowISO(), updated_at:nowISO() }
  },
  async batchCreate(orderPayloads) {
    const batch = writeBatch(db)
    const created = []
    for (const data of orderPayloads) {
      const ref = doc(collection(db,'orders'))
      const payload = {
        ...data,
        status:data.status || 'pending',
        payment_status:data.payment_status || 'unpaid',
        payable_status:data.payable_status || 'unpaid',
        refund_amount:Number(data.refund_amount || 0),
        refunds:data.refunds || [],
        status_history:[{ status:data.status || 'pending', at:nowISO(), note:'批次建立訂單' }],
        order_date:now(), created_at:now(), updated_at:now(),
      }
      batch.set(ref,payload)
      created.push({ id:ref.id, ...data })
    }
    await batch.commit()
    return created
  },
  async update(id, data) {
    await updateDoc(doc(db,'orders',id), { ...data, updated_at:now() })
  },
  async updateArrival(id, items) {
    const normalizedItems = Array.isArray(items) ? items : []
    const allArrived = normalizedItems.length > 0 && normalizedItems.every(item => {
      const qty = Math.max(0, Number(item?.qty || 0))
      const arrived = Math.max(0, Number(item?.arrived_qty || 0))
      return qty > 0 && arrived >= qty
    })
    await updateDoc(doc(db,'orders',id), { items:normalizedItems, updated_at:now() })
    return { allArrived }
  },
  async updateStatus(id, status, { reason = '' } = {}) {
    const ref = doc(db,'orders',id)
    const patch = {
      status,
      updated_at:now(),
      status_history:arrayUnion({ status, at:nowISO(), note:reason || '' }),
    }
    if (status === 'shipped') {
      const snap = await getDoc(ref)
      const currentPayment = snap.exists() ? snap.data().payment_status : 'unpaid'
      patch.shipped_at = now(); patch.cancelled_at = null; patch.cancellation_reason = ''
      if (!['partial_refund','refunded'].includes(currentPayment)) patch.payment_status = 'paid'
    } else if (status === 'cancelled') {
      patch.cancelled_at = now(); patch.cancellation_reason = reason || ''
    } else if (status === 'pending') {
      patch.shipped_at = null; patch.cancelled_at = null; patch.cancellation_reason = ''
    }
    await updateDoc(ref, patch)
  },
  async updatePayment(id, payment_status) {
    await updateDoc(doc(db,'orders',id), { payment_status, updated_at:now() })
  },
  async updatePayable(id, payable_status) {
    await updateDoc(doc(db,'orders',id), { payable_status, payable_paid_at:payable_status === 'paid' ? now() : null, updated_at:now() })
  },
  async applyRefund(id, { amount, note = '' }) {
    const ref = doc(db,'orders',id)
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new Error('找不到訂單')
    const order = normalize(snap)
    const total = Number(order.total_amount || 0)
    const oldRefund = Number(order.refund_amount || 0)
    const addAmount = Number(amount || 0)
    if (!(addAmount > 0)) throw new Error('退款金額必須大於 0')
    if (oldRefund + addAmount > total) throw new Error('累積退款金額不可超過訂單總額')
    const newRefund = oldRefund + addAmount
    const payment_status = newRefund >= total ? 'refunded' : 'partial_refund'
    await updateDoc(ref, {
      refund_amount:newRefund,
      payment_status,
      refunded_at:now(),
      refunds:arrayUnion({ amount:addAmount, note:note || '', at:nowISO() }),
      updated_at:now(),
    })
  },
  async clearRefunds(id) {
    await updateDoc(doc(db,'orders',id), {
      refund_amount:0, refunds:[], refunded_at:null, payment_status:'paid', updated_at:now(),
    })
  },
  async archive(id) {
    await updateDoc(doc(db,'orders',id), { archived:true, archived_at:now(), updated_at:now() })
  },
  async unarchive(id) {
    await updateDoc(doc(db,'orders',id), { archived:false, archived_at:null, updated_at:now() })
  },

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
  async updateVirtual(ids = [], isVirtual = false) {
    const targetIds = [...new Set((ids || []).filter(Boolean))]
    for (let i=0; i<targetIds.length; i+=400) {
      const batch = writeBatch(db)
      targetIds.slice(i,i+400).forEach(id => batch.update(doc(db,'orders',id), { is_virtual:Boolean(isVirtual), updated_at:now() }))
      await batch.commit()
    }
  },
  async updateItemQty(id, itemIndex, qty) {
    const nextQty = Number(qty)
    if (!Number.isInteger(nextQty) || nextQty < 1) throw new Error('訂購量至少為 1')
    const ref = doc(db,'orders',id)
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new Error('找不到訂單')
    const data = snap.data()
    const items = [...(data.items || [])]
    if (!items[itemIndex]) throw new Error('找不到訂單商品')
    const item = { ...items[itemIndex] }
    const costPrice = Number(item.cost_price || 0)
    const paid = Math.max(0,Number(item.supplier_paid_amount || 0))
    const nextCost = costPrice * nextQty
    if (paid > nextCost + 0.01) throw new Error(`此品項已付供應商 ${paid} 元，數量不可降到已付款成本以下`)
    item.qty = nextQty
    item.subtotal = Number(item.sale_price ?? item.price ?? 0) * nextQty
    item.cost_subtotal = nextCost
    item.arrived_qty = Math.min(nextQty,Math.max(0,Number(item.arrived_qty || 0)))
    if (item.arrived_qty < nextQty) item.arrived_at = null
    if (paid > 0) item.supplier_payment_status = paid >= nextCost - 0.01 ? 'paid' : 'partial'
    items[itemIndex] = item
    const total_amount = items.reduce((sum,row)=>sum + Number(row.subtotal ?? Number(row.sale_price ?? row.price ?? 0)*Number(row.qty||0)),0)
    await updateDoc(ref,{ items,total_amount,updated_at:now() })
    return { items,total_amount }
  },
  async batchUpdateStatus(ids, status) {
    const refs = ids.map(id => doc(db,'orders',id))
    const current = status === 'shipped' ? await Promise.all(refs.map(ref => getDoc(ref))) : []
    const batch = writeBatch(db)
    refs.forEach((ref,index) => {
      const patch = { status, updated_at:now(), status_history:arrayUnion({ status, at:nowISO(), note:'批次更新' }) }
      if (status === 'shipped') {
        patch.shipped_at = now()
        const payment = current[index]?.exists() ? current[index].data().payment_status : 'unpaid'
        if (!['partial_refund','refunded'].includes(payment)) patch.payment_status = 'paid'
      } else if (status === 'pending') {
        patch.shipped_at = null
      }
      batch.update(ref,patch)
    })
    await batch.commit()
  },
}

export const StatsAPI = {
  async getSummary() {
    const [products,customers,orders] = await Promise.all([ProductsAPI.list(),CustomersAPI.list(),OrdersAPI.list()])
    const activeOrders = orders.filter(o => o.status !== 'cancelled' && !o.archived && !o.is_virtual)
    const shippedOrders = activeOrders.filter(o => o.status === 'shipped')
    const paidOrders = activeOrders.filter(o => ['paid','partial_refund','refunded'].includes(o.payment_status))
    return {
      productCount:products.length,
      customerCount:customers.length,
      orderCount:activeOrders.length,
      pendingCount:activeOrders.filter(o => o.status === 'pending').length,
      orderValue:activeOrders.reduce((s,o) => s + effectiveOrderAmount(o),0),
      shippedRevenue:shippedOrders.reduce((s,o) => s + effectiveOrderAmount(o),0),
      collectedAmount:paidOrders.reduce((s,o) => s + effectiveOrderAmount(o),0),
      outstandingAmount:activeOrders.filter(o => o.payment_status === 'unpaid').reduce((s,o) => s + effectiveOrderAmount(o),0),
      recentOrders:orders.filter(o => !o.archived).slice(0,5),
    }
  },
}

export const MaintenanceAPI = {
  async backfillLegacyOrderSnapshots() {
    const [products,ordersSnap] = await Promise.all([
      ProductsAPI.list({ includeArchived:true }),
      getDocs(collection(db,'orders')),
    ])
    const productMap = Object.fromEntries(products.map(p => [p.id,p]))
    const targets = ordersSnap.docs.filter(orderDoc => {
      const data = orderDoc.data()
      return (data.items || []).some(item =>
        item.cost_price === undefined || item.sale_price === undefined ||
        item.category === undefined || item.product_id === undefined
      ) || data.payable_status === undefined || data.refund_amount === undefined
    })
    let updated = 0
    for (let i=0; i<targets.length; i+=400) {
      const batch = writeBatch(db)
      targets.slice(i,i+400).forEach(orderDoc => {
        const data = orderDoc.data()
        const items = (data.items || []).map(item => {
          const pid = item.product_id || item.id
          const product = productMap[pid] || {}
          const qty = Number(item.qty || 0)
          const salePrice = Number(item.sale_price ?? item.price ?? product.price ?? 0)
          const costPrice = Number(item.cost_price ?? product.cost ?? 0)
          return {
            ...item,
            id:pid,
            product_id:pid,
            name:item.name || item.product_name || product.name || '已刪除商品',
            product_name:item.product_name || item.name || product.name || '已刪除商品',
            price:salePrice,
            sale_price:salePrice,
            cost_price:costPrice,
            category:item.category || product.category || 'other',
            supplier:item.supplier ?? product.supplier ?? '',
            subtotal:Number(item.subtotal ?? salePrice * qty),
            cost_subtotal:Number(item.cost_subtotal ?? costPrice * qty),
            spec:{ color:item.spec?.color || '', size:item.spec?.size || '', flavor:item.spec?.flavor || '' },
          }
        })
        batch.update(orderDoc.ref, {
          items,
          payable_status:data.payable_status || 'unpaid',
          refund_amount:Number(data.refund_amount || 0),
          refunds:data.refunds || [],
          updated_at:now(),
        })
        updated += 1
      })
      await batch.commit()
    }
    return { scanned:ordersSnap.size, updated }
  },
}
