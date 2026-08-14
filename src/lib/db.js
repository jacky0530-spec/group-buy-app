import {
  collection, doc,
  getDocs, getDoc, addDoc, updateDoc,
  query, orderBy, where, Timestamp,
  writeBatch, arrayUnion, limit, startAfter,
} from 'firebase/firestore'
import { db } from './firebase'

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
    'cancelled_at','refunded_at','archived_at',
  ]
  timeFields.forEach(f => { if (d[f]) d[f] = tsToISO(d[f]) })
  return d
}

const now = () => Timestamp.now()
const nowISO = () => new Date().toISOString()
const activeOnly = rows => rows.filter(x => x.active !== false)

export function snapshotOrderItem(product, { qty = 1, note = '', spec = {} } = {}) {
  const price = Number(product.price || 0)
  const cost = Number(product.cost || 0)
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
    qty: quantity,
    subtotal: price * quantity,
    cost_subtotal: cost * quantity,
    note: note || '',
    spec: {
      color: spec?.color || '',
      size: spec?.size || '',
      flavor: spec?.flavor || '',
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

export const ProductsAPI = {
  async list({ includeArchived = false } = {}) {
    const snap = await getDocs(query(collection(db,'products'), orderBy('created_at','desc')))
    const rows = snap.docs.map(normalize)
    return includeArchived ? rows : activeOnly(rows)
  },
  async create(data) {
    const payload = { ...data, active:true, created_at:now(), updated_at:now() }
    const ref = await addDoc(collection(db,'products'), payload)
    return { id:ref.id, ...data, active:true, created_at:nowISO(), updated_at:nowISO() }
  },
  async update(id, data) {
    await updateDoc(doc(db,'products',id), { ...data, updated_at:now() })
  },
  async archive(id) {
    await updateDoc(doc(db,'products',id), { active:false, archived_at:now(), updated_at:now() })
  },
  async restore(id) {
    await updateDoc(doc(db,'products',id), { active:true, archived_at:null, updated_at:now() })
  },
  async isDuplicate(name, excludeId = null) {
    const snap = await getDocs(query(collection(db,'products'), where('name','==',name)))
    return snap.docs.some(d => d.id !== excludeId && d.data().active !== false)
  },
}

export const CustomersAPI = {
  async list({ includeArchived = false } = {}) {
    const snap = await getDocs(query(collection(db,'customers'), orderBy('joined_at','desc')))
    const rows = snap.docs.map(normalize)
    return includeArchived ? rows : activeOnly(rows)
  },
  async create(data) {
    const payload = { ...data, active:true, joined_at:now(), updated_at:now() }
    const ref = await addDoc(collection(db,'customers'), payload)
    return { id:ref.id, ...data, active:true, joined_at:nowISO() }
  },
  async update(id, data) {
    await updateDoc(doc(db,'customers',id), { ...data, updated_at:now() })
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
  async updateStatus(id, status, { reason = '' } = {}) {
    const patch = {
      status,
      updated_at:now(),
      status_history:arrayUnion({ status, at:nowISO(), note:reason || '' }),
    }
    if (status === 'shipped') {
      patch.shipped_at = now(); patch.cancelled_at = null; patch.cancellation_reason = ''
    } else if (status === 'cancelled') {
      patch.cancelled_at = now(); patch.cancellation_reason = reason || ''
    } else if (status === 'pending') {
      patch.shipped_at = null; patch.cancelled_at = null; patch.cancellation_reason = ''
    }
    await updateDoc(doc(db,'orders',id), patch)
  },
  async updatePayment(id, payment_status) {
    await updateDoc(doc(db,'orders',id), { payment_status, updated_at:now() })
  },
  async updatePayable(id, payable_status) {
    await updateDoc(doc(db,'orders',id), { payable_status, updated_at:now() })
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
  async batchUpdateStatus(ids, status) {
    const batch = writeBatch(db)
    ids.forEach(id => {
      const patch = { status, updated_at:now(), status_history:arrayUnion({ status, at:nowISO(), note:'批次更新' }) }
      if (status === 'shipped') patch.shipped_at = now()
      batch.update(doc(db,'orders',id),patch)
    })
    await batch.commit()
  },
}

export const StatsAPI = {
  async getSummary() {
    const [products,customers,orders] = await Promise.all([ProductsAPI.list(),CustomersAPI.list(),OrdersAPI.list()])
    const activeOrders = orders.filter(o => o.status !== 'cancelled' && !o.archived)
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
