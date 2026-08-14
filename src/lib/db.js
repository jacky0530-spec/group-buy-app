import { supabase } from './supabase'

const nowISO = () => new Date().toISOString()

function fail(error, fallback = '資料庫操作失敗') {
  if (!error) return
  const err = new Error(error.message || fallback)
  err.code = error.code
  throw err
}

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
    const fallback = currentCostMap[item.product_id || item.id] || 0
    return sum + Number(item.cost_price ?? fallback) * qty
  }, 0)
}

export const ProductsAPI = {
  async list({ includeArchived = false } = {}) {
    let q = supabase.from('products').select('*').order('created_at', { ascending: false })
    if (!includeArchived) q = q.eq('active', true)
    const { data, error } = await q
    fail(error)
    return data || []
  },

  async create(data) {
    const payload = { ...data, active: true, created_at: nowISO(), updated_at: nowISO() }
    const { data: row, error } = await supabase.from('products').insert(payload).select('*').single()
    fail(error)
    return row
  },

  async update(id, data) {
    const { error } = await supabase.from('products').update({ ...data, updated_at: nowISO() }).eq('id', id)
    fail(error)
  },

  async archive(id) {
    const { error } = await supabase.from('products').update({ active: false, archived_at: nowISO(), updated_at: nowISO() }).eq('id', id)
    fail(error)
  },

  async restore(id) {
    const { error } = await supabase.from('products').update({ active: true, archived_at: null, updated_at: nowISO() }).eq('id', id)
    fail(error)
  },

  async isDuplicate(name, excludeId = null) {
    const { data, error } = await supabase.from('products').select('id,name').eq('active', true).eq('name', name)
    fail(error)
    return (data || []).some(row => row.id !== excludeId)
  },
}

export const CustomersAPI = {
  async list({ includeArchived = false } = {}) {
    let q = supabase.from('customers').select('*').order('joined_at', { ascending: false })
    if (!includeArchived) q = q.eq('active', true)
    const { data, error } = await q
    fail(error)
    return data || []
  },

  async create(data) {
    const payload = { ...data, active: true, joined_at: nowISO(), updated_at: nowISO() }
    const { data: row, error } = await supabase.from('customers').insert(payload).select('*').single()
    fail(error)
    return row
  },

  async update(id, data) {
    const { error } = await supabase.from('customers').update({ ...data, updated_at: nowISO() }).eq('id', id)
    fail(error)
  },

  async archive(id) {
    const { error } = await supabase.from('customers').update({ active: false, archived_at: nowISO(), updated_at: nowISO() }).eq('id', id)
    fail(error)
  },

  async restore(id) {
    const { error } = await supabase.from('customers').update({ active: true, archived_at: null, updated_at: nowISO() }).eq('id', id)
    fail(error)
  },

  async isDuplicateIdentity({ phone = '', line_nick = '', fb_name = '' }, excludeId = null) {
    const checks = [['phone', phone.trim()], ['line_nick', line_nick.trim()], ['fb_name', fb_name.trim()]].filter(([, value]) => value)
    for (const [field, value] of checks) {
      const { data, error } = await supabase.from('customers').select('id').eq('active', true).eq(field, value)
      fail(error)
      if ((data || []).some(row => row.id !== excludeId)) return { duplicate: true, field, value }
    }
    return { duplicate: false }
  },
}

export const OrdersAPI = {
  async list() {
    const { data, error } = await supabase.from('orders').select('*').order('order_date', { ascending: false })
    fail(error)
    return data || []
  },

  async listByDateRange(startISO, endISO) {
    let q = supabase.from('orders').select('*').order('order_date', { ascending: false })
    if (startISO) q = q.gte('order_date', startISO)
    if (endISO) q = q.lte('order_date', endISO)
    const { data, error } = await q
    fail(error)
    return data || []
  },

  async listPage({ pageSize = 100, cursor = 0 } = {}) {
    const offset = Number(cursor || 0)
    const { data, error } = await supabase.from('orders').select('*').order('order_date', { ascending: false }).range(offset, offset + pageSize - 1)
    fail(error)
    const rows = data || []
    return { rows, nextCursor: rows.length === pageSize ? offset + pageSize : null, hasMore: rows.length === pageSize }
  },

  async create(data) {
    const stamp = nowISO()
    const payload = {
      ...data,
      status: data.status || 'pending',
      payment_status: data.payment_status || 'unpaid',
      payable_status: data.payable_status || 'unpaid',
      refund_amount: Number(data.refund_amount || 0),
      refunds: data.refunds || [],
      status_history: data.status_history || [{ status: data.status || 'pending', at: stamp, note: '建立訂單' }],
      order_date: data.order_date || stamp,
      created_at: stamp,
      updated_at: stamp,
      archived: data.archived === true,
    }
    const { data: row, error } = await supabase.from('orders').insert(payload).select('*').single()
    fail(error)
    return row
  },

  async batchCreate(orderPayloads) {
    const stamp = nowISO()
    const payloads = orderPayloads.map(data => ({
      ...data,
      status: data.status || 'pending',
      payment_status: data.payment_status || 'unpaid',
      payable_status: data.payable_status || 'unpaid',
      refund_amount: Number(data.refund_amount || 0),
      refunds: data.refunds || [],
      status_history: [{ status: data.status || 'pending', at: stamp, note: '批次建立訂單' }],
      order_date: data.order_date || stamp,
      created_at: stamp,
      updated_at: stamp,
      archived: data.archived === true,
    }))
    const { data, error } = await supabase.from('orders').insert(payloads).select('*')
    fail(error)
    return data || []
  },

  async update(id, data) {
    const { error } = await supabase.from('orders').update({ ...data, updated_at: nowISO() }).eq('id', id)
    fail(error)
  },

  async updateStatus(id, status, { reason = '' } = {}) {
    const { error } = await supabase.rpc('set_order_status', { p_order_id: id, p_status: status, p_reason: reason || '' })
    fail(error)
  },

  async updatePayment(id, payment_status) {
    const { error } = await supabase.from('orders').update({ payment_status, updated_at: nowISO() }).eq('id', id)
    fail(error)
  },

  async updatePayable(id, payable_status) {
    const { error } = await supabase.from('orders').update({ payable_status, updated_at: nowISO() }).eq('id', id)
    fail(error)
  },

  async applyRefund(id, { amount, note = '' }) {
    const { error } = await supabase.rpc('apply_order_refund', { p_order_id: id, p_amount: Number(amount || 0), p_note: note || '' })
    fail(error)
  },

  async clearRefunds(id) {
    const { error } = await supabase.rpc('clear_order_refunds', { p_order_id: id })
    fail(error)
  },

  async archive(id) {
    const { error } = await supabase.from('orders').update({ archived: true, archived_at: nowISO(), updated_at: nowISO() }).eq('id', id)
    fail(error)
  },

  async batchUpdateStatus(ids, status) {
    const { error } = await supabase.rpc('batch_set_order_status', { p_ids: ids, p_status: status })
    fail(error)
  },
}

export const AccountsAPI = {
  async list() {
    const { data, error } = await supabase.from('accounts').select('*').order('created_at', { ascending: true })
    fail(error)
    return data || []
  },

  async get(id) {
    const { data, error } = await supabase.from('accounts').select('*').eq('id', id).maybeSingle()
    fail(error)
    return data
  },

  async setDisabled(id, disabled) {
    const { error } = await supabase.from('accounts').update({ disabled, updated_at: nowISO() }).eq('id', id)
    fail(error)
  },

  async setRole(id, role) {
    const { error } = await supabase.from('accounts').update({ role, updated_at: nowISO() }).eq('id', id)
    fail(error)
  },
}

export const StatsAPI = {
  async getSummary() {
    const [products, customers, orders] = await Promise.all([ProductsAPI.list(), CustomersAPI.list(), OrdersAPI.list()])
    const activeOrders = orders.filter(o => o.status !== 'cancelled' && !o.archived)
    const shippedOrders = activeOrders.filter(o => o.status === 'shipped')
    const paidOrders = activeOrders.filter(o => ['paid', 'partial_refund', 'refunded'].includes(o.payment_status))
    return {
      productCount: products.length,
      customerCount: customers.length,
      orderCount: activeOrders.length,
      pendingCount: activeOrders.filter(o => o.status === 'pending').length,
      orderValue: activeOrders.reduce((s, o) => s + effectiveOrderAmount(o), 0),
      shippedRevenue: shippedOrders.reduce((s, o) => s + effectiveOrderAmount(o), 0),
      collectedAmount: paidOrders.reduce((s, o) => s + effectiveOrderAmount(o), 0),
      outstandingAmount: activeOrders.filter(o => o.payment_status === 'unpaid').reduce((s, o) => s + effectiveOrderAmount(o), 0),
      recentOrders: orders.filter(o => !o.archived).slice(0, 5),
    }
  },
}

export const MaintenanceAPI = {
  async backfillLegacyOrderSnapshots() {
    const [products, orders] = await Promise.all([ProductsAPI.list({ includeArchived: true }), OrdersAPI.list()])
    const productMap = Object.fromEntries(products.map(p => [p.id, p]))
    const targets = orders.filter(order =>
      (order.items || []).some(item => item.cost_price === undefined || item.sale_price === undefined || item.category === undefined || item.product_id === undefined) ||
      order.payable_status === undefined || order.refund_amount === undefined
    )

    let updated = 0
    for (let i = 0; i < targets.length; i += 20) {
      await Promise.all(targets.slice(i, i + 20).map(async order => {
        const items = (order.items || []).map(item => {
          const pid = item.product_id || item.id
          const product = productMap[pid] || {}
          const qty = Number(item.qty || 0)
          const salePrice = Number(item.sale_price ?? item.price ?? product.price ?? 0)
          const costPrice = Number(item.cost_price ?? product.cost ?? 0)
          return {
            ...item,
            id: pid,
            product_id: pid,
            name: item.name || item.product_name || product.name || '已刪除商品',
            product_name: item.product_name || item.name || product.name || '已刪除商品',
            price: salePrice,
            sale_price: salePrice,
            cost_price: costPrice,
            category: item.category || product.category || 'other',
            supplier: item.supplier ?? product.supplier ?? '',
            subtotal: Number(item.subtotal ?? salePrice * qty),
            cost_subtotal: Number(item.cost_subtotal ?? costPrice * qty),
            spec: { color: item.spec?.color || '', size: item.spec?.size || '', flavor: item.spec?.flavor || '' },
          }
        })
        await OrdersAPI.update(order.id, {
          items,
          payable_status: order.payable_status || 'unpaid',
          refund_amount: Number(order.refund_amount || 0),
          refunds: order.refunds || [],
        })
        updated += 1
      }))
    }
    return { scanned: orders.length, updated }
  },
}
